"""Build candidate real-photo test labels from Open Food Facts (OFF).

OFF photos are real phone photos of real packs, which is what the real-photo
set needs. But OFF ingredient text was typed (or OCR'd) by volunteers from a
photo, not checked against the pack in hand. So every record this script
writes is tagged `off_unverified` and must be checked by a person before it
counts as ground truth (see README.md, "Open Food Facts records").

What it does:
  1. Searches OFF for products sold in India, brand by brand.
  2. Reads each candidate's full record: ingredient text per language, the
     photo OFF selected as the ingredients photo, allergen and trace tags.
  3. Keeps a product only if the ingredients photo and the ingredient text are
     in the same language *on the same barcode*. The barcode is the exact
     variant: nothing is ever copied from one variant to another.
  4. Downloads the photo exactly as uploaded (no OFF crop, rotation or
     whitening) into images/, and writes one line per product to labels.jsonl
     in the schema of labels.example.jsonl.
  5. Optionally writes clearly tagged transformed copies (blur, glare,
     rotation, low resolution) as separate lines.

Nothing is filled in. Missing text means no record; anything that looks
incomplete is listed in the record's notes and in off_manifest.json.

Licences: OFF data is ODbL, photos are CC BY-SA 3.0, both © Open Food Facts
contributors. Downloaded photos stay in the git-ignored images/ folder.

Rate limits (OFF API docs): 10 searches/min, 100 product reads/min. Search
results carry the full records, so only searches and photo downloads are
made, spaced to stay under the limits, and caches every response in .off_cache/.

Usage:
  .venv/bin/python -m eval.real.build_from_off survey      # counts only, no downloads
  .venv/bin/python -m eval.real.build_from_off build [--transforms]
"""

import argparse
import json
import os
import random
import re
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import cv2

ROOT = Path(__file__).parent
CACHE = ROOT / ".off_cache"
IMAGES = ROOT / "images"
LABELS = ROOT / "labels.jsonl"
MANIFEST = ROOT / "off_manifest.json"

API = "https://world.openfoodfacts.org"
IMG_HOST = "https://images.openfoodfacts.org/images/products"
# OFF asks every client to identify itself. Set OFF_CONTACT to add an email or URL.
USER_AGENT = f"LabelLens-eval/0.1 ({os.environ.get('OFF_CONTACT', 'student research project, eval dataset builder')})"
SEARCH_GAP_S = 6.5  # 10 searches/min allowed
IMAGE_GAP_S = 0.5

# OFF brand tags. Brands the user named first, then other common Indian brands
# so the set reaches 30+ products with usable data.
BRANDS = [
    "maggi", "parle", "britannia", "amul", "haldiram-s", "haldirams", "kurkure", "lay-s", "mdh", "everest",
    "bikaji", "sunfeast", "cadbury", "mother-dairy", "tata-sampann", "bingo", "patanjali", "mtr", "balaji",
]

MIN_SHORT_SIDE = 400  # smaller photos can't show a full ingredients panel legibly

# Allergen keywords used only to *find* allergen terms that are printed in the
# ingredient text. A term is always copied from the text, never added.
ALLERGEN_WORDS = {
    "gluten": r"wheat|maida|atta|semolina|suji|sooji|rava|barley|\brye\b|\boats?\b|gluten|\bmalt\b",
    "milk": r"milk|whey|casein(?:ate)?|butter|ghee|cheese|cream|khoa|khoya|paneer|curd|lactose|dairy",
    "peanuts": r"peanuts?|groundnuts?",
    "nuts": r"almonds?|cashews?|pistachios?|walnuts?|hazelnuts?|tree nuts?|(?<!coco)(?<!dough)\bnuts?\b",
    "soybeans": r"soy|soya|soybeans?",
    "eggs": r"eggs?|albumin",
    "sesame-seeds": r"sesame|\btil\b|gingelly",
    "mustard": r"mustard|\brai\b",
    "fish": r"\bfish\b",
    "crustaceans": r"crustaceans?|shrimps?|prawns?",
    "sulphur-dioxide-and-sulphites": r"sulphites?|sulfites?|sulphur dioxide|\b22[0-8]\b|e22[0-8]",
    "celery": r"celery",
}
NOT_ALLERGEN = r"cocoa butter|coconut|nutmeg|buckwheat|butterfly|egg ?plant|eggless|nutrient|nutrition|soy ?free|milk ?free|gluten ?free"

PRODUCT_TYPES = [
    ("biscuit", ("biscuits", "cookies", "crackers", "wafers")), ("noodles", ("noodles", "pasta")),
    ("namkeen", ("namkeen", "bhujia", "mixtures")), ("chips", ("chips", "crisps", "extruded")),
    ("chocolate", ("chocolate", "confectioner", "candies")), ("spices", ("spice", "masala", "condiment", "seasoning")),
    ("dairy", ("dairies", "dairy", "milk", "cheese", "butter", "ghee", "yogurt")), ("beverage", ("beverage", "drink", "juice")),
    ("bakery", ("bread", "cake", "rusk")), ("sauce", ("sauce", "ketchup")),
]


# ---------------------------------------------------------------- fetching

_last = {}


def _wait(kind: str, gap: float):
    elapsed = time.monotonic() - _last.get(kind, 0)
    if elapsed < gap:
        time.sleep(gap - elapsed)
    _last[kind] = time.monotonic()


def _get(url: str, kind: str, gap: float, binary=False):
    for attempt in range(3):
        _wait(kind, gap)
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
            return body if binary else json.loads(body)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code != 429 and e.code < 500:
                raise
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(5 * (attempt + 1))  # 429, 5xx or network: back off
    raise RuntimeError(f"OFF unavailable: {url}")


def _cached(name: str, fetch):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"{name}.json"
    if path.exists():
        return json.loads(path.read_text())
    data = fetch()
    path.write_text(json.dumps(data))
    return data


def search_brand(brand: str) -> list[dict]:
    """Full records (all fields) of up to 100 products of one brand sold in India."""
    q = urllib.parse.urlencode({"countries_tags_en": "india", "brands_tags": brand, "page_size": 100})
    data = _cached(f"search_{brand}", lambda: _get(f"{API}/api/v2/search?{q}", "search", SEARCH_GAP_S))
    return [p for p in (data or {}).get("products", []) if p.get("code")]


def image_folder(code: str) -> str:
    if len(code) <= 8:
        return code
    code = code.zfill(13)
    return f"{code[:3]}/{code[3:6]}/{code[6:9]}/{code[9:]}"


# ---------------------------------------------------------------- checking

def _clean_text(text: str) -> str:
    # OFF marks allergens as _milk_; the pack doesn't print the underscores.
    return re.sub(r"\s+", " ", re.sub(r"(?<!\w)_([^_]+)_(?!\w)", r"\1", text)).strip()


def allergen_terms(text: str) -> tuple[list[str], set[str]]:
    """Fragments of the printed text that contain an allergen word, and their groups."""
    terms, groups = [], set()
    for frag in re.split(r"[,;:()\[\]{}.*®#&]|\band\b", text):
        frag = frag.strip(" -–")
        low = re.sub(NOT_ALLERGEN, lambda m: " " * len(m.group()), frag.lower())
        for g, pat in ALLERGEN_WORDS.items():
            m = re.search(rf"(?:{pat})", low)
            if not m:
                continue
            groups.add(g)
            # Short fragments are kept whole ("Milk solids"); in long ones only the printed word.
            term = frag if len(frag.split()) <= 4 else frag[m.start():m.end()]
            if term not in terms:
                terms.append(term)
    return terms, groups


# Real words missing from the app lexicon that appear on Indian packs.
KNOWN_WORDS = {"chilli", "chillies", "ins", "trans", "kcal", "ltd", "pvt", "mfd", "centre", "bengal", "choco", "polyols",
               "rda", "approx", "lic", "fssai", "britannia", "maggi", "tastemaker", "kalonji", "ajwain", "amchur"}
NON_INGREDIENT = r"\b(kcal|energy|mfd|pvt|ltd|best before|net w(?:t|eight)|mrp|lic(?:ence)? no|customer care|marketed by)\b"


def suspect_words(text: str) -> list[str]:
    """Words that are in no dictionary we have: possible typos in the OFF text."""
    from app import lexicon
    words = re.findall(r"[^\W\d_]{3,}", text)
    return sorted({w for w in words if w.lower() not in KNOWN_WORDS
                   and not lexicon.plausible(w, include_indian=True, food_only=False)})


def product_type(p: dict) -> str:
    cats = " ".join(p.get("categories_tags") or []).lower()
    for name, keys in PRODUCT_TYPES:
        if any(k in cats for k in keys):
            return name
    return "other"


def assess(code: str, p: dict) -> dict:
    """Decide whether a product gives a usable record. Never fills gaps."""
    images = p.get("images") or {}
    out = {"code": code, "name": p.get("product_name") or "", "brands": p.get("brands") or "",
           "usable": False, "reasons": [], "flags": []}
    # Ingredients photo and text must share a language on this barcode.
    pairs = []
    for key, sel in images.items():
        m = re.fullmatch(r"ingredients_([a-z]{2})", key)
        if not m:
            continue
        lc = m.group(1)
        text = _clean_text(p.get(f"ingredients_text_{lc}") or "")
        if text:
            pairs.append((lc, sel, text))
    if not code.startswith("890"):
        out["reasons"].append("barcode not registered in India (GS1 prefix 890): may be a foreign pack")
        return out
    if not pairs:
        has_text = any(re.fullmatch(r"ingredients_text_[a-z]{2}", k) and v for k, v in p.items())
        has_photo = any(k.startswith("ingredients_") for k in images)
        out["reasons"].append(
            "no ingredient text" if not has_text else
            "no ingredients photo" if not has_photo else "photo and text are in different languages")
        return out
    pairs = [t for t in pairs if t[0] in ("en", "hi")]
    if not pairs:
        out["reasons"].append("ingredients only in a language other than English or Hindi")
        return out
    pairs.sort(key=lambda t: t[0] != "en")  # prefer English when there are several
    lc, sel, text = pairs[0]
    raw = images.get(str(sel.get("imgid")), {})
    full = (raw.get("sizes") or {}).get("full") or {}
    out.update(lang=lc, imgid=str(sel.get("imgid")), text=text, width=full.get("w"), height=full.get("h"),
               uploaded_t=raw.get("uploaded_t"), uploader=raw.get("uploader"),
               image_url=f"{IMG_HOST}/{image_folder(code)}/{sel.get('imgid')}.jpg",
               selected_url=f"{IMG_HOST}/{image_folder(code)}/ingredients_{lc}.{sel.get('rev')}.full.jpg",
               product_url=f"{API}/product/{code}", last_modified_t=p.get("last_modified_t"),
               off_allergens=sorted(t.split(":", 1)[1] for t in p.get("allergens_tags") or []),
               off_traces=sorted(t.split(":", 1)[1] for t in p.get("traces_tags") or []),
               product_type=product_type(p))
    if not full or min(full.get("w", 0), full.get("h", 0)) < MIN_SHORT_SIDE:
        out["reasons"].append(f"photo too small ({full.get('w')}x{full.get('h')})")
        return out

    # Usable, but say exactly what a person must check.
    flags = out["flags"]
    if any(k.startswith(f"ingredients_text_{lc}_ocr_") for k in p):
        flags.append("text may be machine OCR output saved by OFF, not typed by a person")
    if "en:ingredients-to-be-completed" in (p.get("states_tags") or []):
        flags.append("OFF marks the ingredients as incomplete")
    if p.get("last_modified_t") and raw.get("uploaded_t") and int(raw["uploaded_t"]) < int(p["last_modified_t"]) - 365 * 86400:
        flags.append("photo is over a year older than the latest edit: the pack may have been reformulated")
    if not re.search(r"[.)\]]\s*$", text):
        flags.append("text doesn't end with a full stop or bracket: it may be cut short")
    if len(re.split(r",", text)) < 3:
        flags.append("fewer than 3 ingredients: possibly incomplete")
    if "#" in text or "�" in text:
        flags.append("text contains '#' or broken characters")
    if re.search(NON_INGREDIENT, text, re.I):
        flags.append("text includes non-ingredient text (nutrition, address or licence): ground truth must be the ingredients and allergen statements only")
    typos = suspect_words(text)
    if typos:
        flags.append(f"words not in any dictionary, possible typos: {typos[:12]}")
    if sel.get("angle") not in (None, 0, "0"):
        flags.append(f"photo needs rotating by {sel.get('angle')} degrees (OFF's crop does this; the original is kept as uploaded)")
    terms, groups = allergen_terms(text)
    missing = sorted(g for g in out["off_allergens"] if g in ALLERGEN_WORDS and g not in groups)
    if missing:
        flags.append(f"OFF lists allergens {missing} but no matching printed term was found")
    if out["off_traces"] and not re.search(r"may contain|traces", text, re.I):
        flags.append(f"OFF lists traces {out['off_traces']} but no 'may contain' statement is in the text")
    if not terms:
        flags.append("no allergen terms found in the text (allergen recall can't be scored)")
    out.update(usable=True, allergens=terms,
               language="en+hi" if re.search(r"[ऀ-ॿ]", text) else lc)
    return out


# ---------------------------------------------------------------- building

def survey() -> list[dict]:
    products = {}
    for brand in BRANDS:
        try:
            found = search_brand(brand)
        except RuntimeError as e:
            print(f"{brand:14s} search failed, skipped (re-run later to retry): {e}")
            continue
        new = [p for p in found if p["code"] not in products]
        products.update((p["code"], p) for p in new)
        print(f"{brand:14s} {len(found):4d} products in India ({len(new)} new)")
    return [assess(code, p) for code, p in products.items()]


def summarise(results: list[dict]):
    from collections import Counter
    usable = [r for r in results if r["usable"]]
    print(f"\nproducts found: {len(results)}")
    print(f"usable (ingredients photo + same-language text on the same barcode, photo >= {MIN_SHORT_SIDE}px): {len(usable)}")
    print("not usable:", dict(Counter(r["reasons"][0] for r in results if not r["usable"])))
    print("usable with no flags:", sum(not r["flags"] for r in usable))
    flag_counts = Counter(re.sub(r"\[.*?\]|\(.*?\)|\d+|:.*", "", f).strip() for r in usable for f in r["flags"])
    for f, n in flag_counts.most_common():
        print(f"  {n:4d}  {f}")
    print("by brand:", dict(Counter((r["brands"].split(",")[0].strip().lower() or "?") for r in usable).most_common(25)))
    print("by type:", dict(Counter(r["product_type"] for r in usable)))
    print("by language:", dict(Counter(r["language"] for r in usable)))


TRANSFORMS = {
    "blur": lambda img, rng: cv2.GaussianBlur(img, (0, 0), 2.0 * max(img.shape[:2]) / 1500),
    "glare": None,  # filled from eval.synth below
    "rotation": None,
    "lowres": lambda img, rng: cv2.resize(cv2.resize(img, None, fx=0.35, fy=0.35, interpolation=cv2.INTER_AREA),
                                          (img.shape[1], img.shape[0]), interpolation=cv2.INTER_LINEAR),
}


def _transforms():
    from eval import synth
    t = dict(TRANSFORMS)
    t["glare"] = synth.glare
    t["rotation"] = lambda img, rng: synth.rotate(img, rng.choice([-1, 1]) * rng.uniform(8, 15))
    return t


def _notes(r: dict, today: str) -> str:
    who = f"photo by OFF contributor '{r['uploader']}'" if r.get("uploader") else "photo by an OFF contributor"
    flags = "; ".join(r["flags"]) or "none found automatically"
    return (f"UNVERIFIED: text and photo from Open Food Facts, barcode {r['code']} ({r['name']}, {r['brands']}), "
            f"retrieved {today}. Product: {r['product_url']} Photo: {r['image_url']} ({who}, CC BY-SA 3.0); "
            f"text ODbL, © Open Food Facts contributors. Text was typed from a photo, not the pack: check it against "
            f"the photo (or the pack) before trusting it. Flags: {flags}")


def build(results: list[dict], with_transforms: bool):
    IMAGES.mkdir(exist_ok=True)
    today = date.today().isoformat()
    # Keep hand-made lines and OFF lines a person has already verified (tag removed).
    kept = []
    if LABELS.exists():
        for line in LABELS.read_text().splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            if "off_unverified" not in rec.get("conditions", []):
                kept.append(rec)
    kept_ids = {r["id"] for r in kept}

    records, manifest = [], []
    transforms = _transforms() if with_transforms else {}
    for r in (r for r in results if r["usable"]):
        rid = f"off_{r['code']}_{r['lang']}"
        if rid in kept_ids:
            continue
        dest = IMAGES / f"{rid}.jpg"
        if not dest.exists():
            data = _get(r["image_url"], "image", IMAGE_GAP_S, binary=True)
            if not data:
                print(f"skip {rid}: photo missing on OFF")
                continue
            dest.write_bytes(data)  # bytes exactly as uploaded
        img = cv2.imread(str(dest))
        if img is None:
            print(f"skip {rid}: photo can't be decoded")
            dest.unlink()
            continue
        base = {"id": rid, "images": [f"images/{dest.name}"], "text": r["text"], "allergens": r["allergens"],
                "language": r["language"], "conditions": ["off_unverified"], "product_type": r["product_type"],
                "notes": _notes(r, today)}
        records.append(base)
        manifest.append({**{k: v for k, v in r.items() if k not in ("text",)}, "id": rid, "retrieved": today})
        for name, fn in transforms.items():
            tid = f"{rid}__t_{name}"
            tdest = IMAGES / f"{tid}.jpg"
            if not tdest.exists():
                rng = random.Random(f"{rid}:{name}")
                cv2.imwrite(str(tdest), fn(img, rng), [cv2.IMWRITE_JPEG_QUALITY, 92])
            records.append({**base, "id": tid, "images": [f"images/{tdest.name}"],
                            "conditions": ["off_unverified", "transformed", f"transformed:{name}"],
                            "notes": f"TRANSFORMED ({name}) copy of {rid}, generated by build_from_off.py; "
                                     f"not a real photo condition. " + base["notes"]})

    LABELS.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in kept + records))
    MANIFEST.write_text(json.dumps({
        "source": "Open Food Facts (https://world.openfoodfacts.org)",
        "licence": "Database: ODbL 1.0. Photos: CC BY-SA 3.0. © Open Food Facts contributors.",
        "retrieved": today, "status": "unverified: every record needs manual checking", "products": manifest,
    }, indent=1, ensure_ascii=False))
    print(f"wrote {len(records)} OFF lines ({len(manifest)} products) + kept {len(kept)} existing lines -> {LABELS}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["survey", "build"])
    ap.add_argument("--transforms", action="store_true", help="also write blur/glare/rotation/low-res copies")
    args = ap.parse_args()
    results = survey()
    summarise(results)
    if args.command == "build":
        build(results, args.transforms)


if __name__ == "__main__":
    main()
