"""The full label-reading pipeline.

photos -> quality check -> preprocessing variants -> OCR on each variant
-> word-level fusion -> (optional) independent Claude transcription
-> merge overlapping photos -> ingredients and allergen statements, each
with a status and the words/boxes it came from.

Settings marked CALIBRATED were chosen on the TRAIN half of the synthetic
benchmark (see eval/results/synthetic_report.md) and must be re-checked
on real photos.
"""

import re
from dataclasses import asdict, dataclass, field
from difflib import SequenceMatcher

from app import claude_reader, fusion, lexicon, ocr, preprocess, quality

# CALIBRATED on the TRAIN half of the synthetic benchmark
# (eval/results/synthetic_report.md, section 4): fewest silent errors with
# at most 35% of words flagged and at most 50% of correct words flagged in
# any condition the reader mostly gets right. Re-check on real photos.
FUSION_VARIANTS = ["adaptive", "denoise_sharpen"]
LOW_SCORE = 0.5  # below this the engine's own reading is "unreadable"
HIGH_SCORE = 0.98  # words scored 0.95-0.98 were right only ~92% of the time

STATUS_RANK = {fusion.UNREADABLE: 4, fusion.CONFLICTING: 3, fusion.MISSING: 2, fusion.PROBABLE: 1, fusion.CONFIRMED: 0}
STATEMENT_START = re.compile(
    r"^(contains?|may contain|may also contain|allergy advice|allergen information|made in a|prepared in a|produced in a|processed in a|manufactured in a|traces of)\b",
    re.I,
)
HEADER = re.compile(r"\bingredients?\s*[:\-]", re.I)


@dataclass
class Item:
    kind: str  # "ingredient" | "statement" | "missing" | "unreadable_region"
    raw: str  # exactly as read (fused words joined)
    status: str
    words: list[dict] = field(default_factory=list)
    photo: int | None = None
    boxes: list[list[int]] = field(default_factory=list)  # [x, y, w, h] on that photo
    sources: list[str] = field(default_factory=list)
    engines_agree: bool | None = None  # True when an independent engine (Claude) read it identically
    needs_review: bool = True
    note: str = ""


def _word_dict(w: fusion.Word, photo: int) -> dict:
    return {
        "text": w.text,
        "status": w.status,
        "photo": photo,
        "box": w.box,
        "score": None if w.score is None else round(w.score, 3),
        "support": w.support,
        "alternatives": {k: v for k, v in w.alternatives.items()},
        "illegible_to": w.illegible_to,
        "plausible": w.plausible,
        "suggestions": w.suggestions,
    }


def read_photo(img, index: int, use_claude: bool) -> dict:
    report = quality.assess(img)
    variants = preprocess.variants(img, report.median_line_height, report.skew_deg, names=FUSION_VARIANTS)
    readings = []
    for v in variants:
        lines = ocr.read(v.image)
        readings.append(fusion.Reading(
            f"rapidocr:{v.name}",
            [{"text": ln.text, "score": ln.score, "box": v.to_original(ln.box)} for ln in lines],
        ))
    words = fusion.fuse(readings, anchor="rapidocr:original")

    claude_text, claude_extras = None, []
    if use_claude and claude_reader.is_configured():
        try:
            claude_text = claude_reader.transcribe(img)
        except Exception:  # noqa: BLE001 - Claude is optional; never fail the read
            claude_text = None
        if claude_text:
            claude_extras = fusion.add_stream_reading(words, "claude", claude_reader.words(claude_text), claude_reader.ILLEGIBLE)

    fusion.assign_status(words, LOW_SCORE, HIGH_SCORE, min_support=1.0,
                         plausible=lexicon.plausible, suggest=lexicon.suggestions)
    return {
        "index": index,
        "report": report,
        "words": words,
        "claude_used": claude_text is not None,
        "claude_only_text": [e for e in claude_extras if e.strip()],
    }


def merge_photos(photos: list[dict]) -> tuple[list[tuple[int, fusion.Word]], list[str]]:
    """Join the word streams of several photos, removing the overlap where
    one photo repeats the end of the previous one."""
    stream: list[tuple[int, fusion.Word]] = []
    notes: list[str] = []
    for p in photos:
        incoming = [(p["index"], w) for w in p["words"]]
        if not stream:
            stream = incoming
            continue
        tail = stream[-60:]
        head = incoming[:60]
        sm = SequenceMatcher(a=[w.text.lower() for _, w in tail], b=[w.text.lower() for _, w in head], autojunk=False)
        m = sm.find_longest_match(0, len(tail), 0, len(head))
        if m.size >= 3:
            # Words seen in both photos: keep the earlier copy, add the support.
            for k in range(m.size):
                kept = tail[m.a + k][1]
                dup = head[m.b + k][1]
                kept.support += [f"photo{p['index'] + 1}:{s}" for s in dup.support]
                if STATUS_RANK[dup.status] < STATUS_RANK[kept.status]:
                    kept.status = dup.status
            stream = stream[: len(stream) - len(tail) + m.a + m.size] + incoming[m.b + m.size:]
        else:
            notes.append(f"Photos {p['index']} and {p['index'] + 1} don't overlap, so text between them could be missing. Check the label.")
            stream += incoming
    return stream, notes


def _split_items(stream: list[tuple[int, fusion.Word]]) -> list[tuple[str, list[int]]]:
    """Split the merged words into top-level ingredients and statements.
    Returns (kind, word indices). Bracket-aware: commas inside (...) or [...]
    don't split."""
    text_words = [w.text for _, w in stream]
    joined = " ".join(text_words)
    starts = []
    pos = 0
    for t in text_words:
        starts.append(pos)
        pos += len(t) + 1

    def words_in(a: int, b: int) -> list[int]:
        return [i for i, s in enumerate(starts) if s < b and s + len(text_words[i]) > a]

    m = HEADER.search(joined)
    body_start = m.end() if m else 0

    items: list[tuple[str, list[int]]] = []
    depth, seg_start, in_statements = 0, body_start, False
    i = body_start
    while i <= len(joined):
        ch = joined[i] if i < len(joined) else "."
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        end_of_sentence = ch == "." and depth == 0 and (i + 1 >= len(joined) or joined[i + 1] == " ") and not re.match(r"\d", joined[i + 1:i + 2] or "")
        rest = joined[i + 1:].lstrip()
        starts_statement = end_of_sentence and bool(STATEMENT_START.match(rest))
        if (ch in ",;" and depth == 0 and not in_statements) or end_of_sentence or i == len(joined):
            seg = joined[seg_start:i].strip(" .")
            if seg:
                kind = "statement" if in_statements or STATEMENT_START.match(seg) else "ingredient"
                items.append((kind, words_in(seg_start, i)))
            seg_start = i + 1
            if starts_statement:
                in_statements = True
        i += 1
    return items


def _item(kind: str, idx: list[int], stream) -> Item:
    pairs = [stream[i] for i in idx]
    worst = max((w.status for _, w in pairs), key=lambda s: STATUS_RANK[s], default=fusion.PROBABLE)
    photo = pairs[0][0] if pairs else None
    sources = sorted({s.split(":", 1)[-1] if s.startswith("photo") else s for _, w in pairs for s in w.support})
    claude_covered = [w for _, w in pairs if "claude" in w.covered_by]
    return Item(
        kind=kind,
        raw=" ".join(w.text for _, w in pairs).strip(" ,;."),
        status=worst,
        words=[_word_dict(w, p) for p, w in pairs],
        photo=photo,
        boxes=[w.box for p, w in pairs if p == photo],
        sources=sources,
        engines_agree=(all("claude" in w.support for w in claude_covered) if claude_covered else None),
        needs_review=worst != fusion.CONFIRMED,
    )


def read_label(images: list, use_claude: bool = True) -> dict:
    photos = [read_photo(img, i, use_claude) for i, img in enumerate(images)]
    stream, notes = merge_photos(photos)
    items = [_item(kind, idx, stream) for kind, idx in _split_items(stream) if idx]

    for p in photos:
        rep = p["report"]
        for edge in rep.cut_off_edges:
            items.append(Item(kind="missing", raw="", status=fusion.MISSING, photo=p["index"],
                              note=f"Text runs off the {edge} edge of photo {p['index'] + 1}. Part of the list may not have been captured."))
        for x, y, w, h in rep.glare_blobs:
            items.append(Item(kind="unreadable_region", raw="", status=fusion.UNREADABLE, photo=p["index"], boxes=[[x, y, w, h]],
                              note=f"Glare covers part of photo {p['index'] + 1} here. Any text under it could not be read."))
        for extra in p["claude_only_text"]:
            items.append(Item(kind="unreadable_region", raw=extra, status=fusion.CONFLICTING, photo=p["index"], sources=["claude"],
                              note="Only the AI reader saw this text; the OCR engine did not. Check it against the label."))

    words_read = [w for _, w in stream]
    if words_read and not HEADER.search(" ".join(w.text for w in words_read[:40])):
        items.insert(0, Item(kind="missing", raw="", status=fusion.MISSING, photo=0,
                             note="The start of the list (\"Ingredients:\") wasn't found. The beginning may be outside the photo."))
    if words_read and not re.search(r"[.!)\]]\.?$", words_read[-1].text):
        last_photo = stream[-1][0]
        items.append(Item(kind="missing", raw="", status=fusion.MISSING, photo=last_photo,
                          note=f"The text stops without a full stop at \"{words_read[-1].text}\". The rest of the list may be outside photo {last_photo + 1}."))

    statements = [it for it in items if it.kind == "statement"]
    allergen_uncertain = (
        any(it.status in (fusion.UNREADABLE, fusion.CONFLICTING) for it in statements)
        or any(it.kind in ("missing", "unreadable_region") for it in items)
    )
    warnings = list(notes)
    if not statements:
        warnings.append("No allergen statement (\"Contains...\" / \"May contain...\") was read. That does NOT mean the product has none. Check the label.")
    if allergen_uncertain:
        warnings.append("Part of the label couldn't be read reliably, so allergens may be missed. Check the physical label before relying on this.")

    return {
        "pipeline": {
            "ocr": "RapidOCR PP-OCRv6 small (ONNX)",
            "variants": ["original", *FUSION_VARIANTS],
            "claude": claude_reader.MODEL if any(p["claude_used"] for p in photos) else None,
            "claude_prompt": claude_reader.PROMPT_VERSION if any(p["claude_used"] for p in photos) else None,
            "calibration": "synthetic benchmark (train half); not yet validated on real photos",
        },
        "photos": [{
            "index": p["index"],
            "width": p["report"].width,
            "height": p["report"].height,
            "verdict": p["report"].verdict,
            "advice": p["report"].advice,
            "usable_fraction": p["report"].usable_fraction,
            "regions": [{"box": r.box, "issues": r.issues} for r in p["report"].regions],
            "glare_blobs": p["report"].glare_blobs,
            "cut_off_edges": p["report"].cut_off_edges,
            "claude_used": p["claude_used"],
        } for p in photos],
        "items": [asdict(it) for it in items],
        "allergen_section_uncertain": allergen_uncertain,
        "warnings": warnings,
        "text": " ".join(w.text for _, w in stream),
    }
