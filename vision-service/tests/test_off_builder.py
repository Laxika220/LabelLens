import json

import cv2
import numpy as np

from eval import metrics
from eval.real import build_from_off as off

CODE = "8901719135767"


def product(**over):
    p = {
        "code": CODE,
        "product_name": "Test Biscuit",
        "brands": "Parle",
        "ingredients_text_en": "Ingredients: Refined wheat flour (Maida), Sugar, _Milk_ solids, Cocoa butter, "
                               "Coconut, Maltodextrin, Emulsifier (Soya lecithin). Contains wheat, milk.",
        "allergens_tags": ["en:gluten", "en:milk", "en:soybeans"],
        "traces_tags": [],
        "states_tags": [],
        "categories_tags": ["en:biscuits"],
        "last_modified_t": 1_700_000_000,
        "images": {
            "ingredients_en": {"imgid": "3", "rev": "9", "angle": 0},
            "3": {"sizes": {"full": {"w": 1200, "h": 1600}}, "uploaded_t": 1_699_000_000, "uploader": "someone"},
        },
    }
    p.update(over)
    return p


def test_usable_record_uses_this_barcodes_text_and_raw_photo():
    r = off.assess(CODE, product())
    assert r["usable"]
    assert r["image_url"].endswith("/890/171/913/5767/3.jpg")  # raw upload, not OFF's processed crop
    assert "_" not in r["text"]  # OFF allergen markup removed
    assert r["language"] == "en"


def test_allergen_terms_are_copied_from_the_text():
    r = off.assess(CODE, product())
    for term in r["allergens"]:
        assert term in r["text"]
    low = [t.lower() for t in r["allergens"]]
    assert "refined wheat flour" in low and "milk solids" in low and "soya lecithin" in low
    assert not any(x in " ".join(low) for x in ("cocoa butter", "coconut", "maltodextrin"))
    # and they score through the existing metric
    assert metrics.allergen_recall(r["text"], r["allergens"]) == 1.0


def test_photo_and_text_must_share_a_language():
    p = product(ingredients_text_en="", ingredients_text_hi="गेहूं का आटा, चीनी")
    r = off.assess(CODE, p)
    assert not r["usable"] and "different languages" in r["reasons"][0]


def test_no_text_means_no_record():
    r = off.assess(CODE, product(ingredients_text_en=""))
    assert not r["usable"] and r["reasons"] == ["no ingredient text"]


def test_foreign_barcode_rejected():
    assert not off.assess("3017620422003", product())["usable"]


def test_small_photo_rejected():
    p = product()
    p["images"]["3"]["sizes"]["full"] = {"w": 300, "h": 300}
    assert not off.assess(CODE, p)["usable"]


def test_flags_for_manual_checking():
    p = product(ingredients_text_en="lodised salt, Sugar", allergens_tags=["en:milk"],
                traces_tags=["en:peanuts"], ingredients_text_en_ocr_1600000000="lodised salt")
    flags = " | ".join(off.assess(CODE, p)["flags"])
    assert "machine OCR" in flags
    assert "possible typos" in flags and "lodised" in flags
    assert "fewer than 3" in flags
    assert "['milk']" in flags  # OFF says milk, the text never prints it
    assert "traces" in flags


def test_build_keeps_hand_lines_and_tags_transforms(tmp_path, monkeypatch):
    monkeypatch.setattr(off, "IMAGES", tmp_path / "images")
    monkeypatch.setattr(off, "LABELS", tmp_path / "labels.jsonl")
    monkeypatch.setattr(off, "MANIFEST", tmp_path / "off_manifest.json")
    jpg = cv2.imencode(".jpg", np.full((600, 500, 3), 255, np.uint8))[1].tobytes()
    monkeypatch.setattr(off, "_get", lambda *a, **k: jpg)
    hand = {"id": "parle_g_front_01", "images": ["images/x.jpg"], "text": "t", "allergens": [], "language": "en",
            "conditions": ["glare"], "product_type": "biscuit", "notes": ""}
    stale = {**hand, "id": "off_old_en", "conditions": ["off_unverified"]}
    (tmp_path / "labels.jsonl").write_text(json.dumps(hand) + "\n" + json.dumps(stale) + "\n")

    off.build([off.assess(CODE, product())], with_transforms=True)

    lines = [json.loads(x) for x in (tmp_path / "labels.jsonl").read_text().splitlines()]
    ids = [x["id"] for x in lines]
    assert ids[0] == "parle_g_front_01" and "off_old_en" not in ids
    schema = set(json.loads((off.ROOT / "labels.example.jsonl").read_text().splitlines()[0]))
    assert all(set(x) == schema for x in lines)
    original = next(x for x in lines if x["id"] == f"off_{CODE}_en")
    assert (tmp_path / "images" / f"off_{CODE}_en.jpg").read_bytes() == jpg  # stored byte for byte
    assert original["notes"].startswith("UNVERIFIED") and "openfoodfacts.org" in original["notes"]
    transformed = [x for x in lines if "transformed" in x["conditions"]]
    assert {x["id"].split("__t_")[1] for x in transformed} == {"blur", "glare", "rotation", "lowres"}
    assert all(x["notes"].startswith("TRANSFORMED") for x in transformed)
