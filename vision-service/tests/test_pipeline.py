import cv2
import pytest
from fastapi.testclient import TestClient

from app import claude_reader, fusion, main, pipeline
from eval import synth

LABEL = {"text": "INGREDIENTS: Wheat Flour, Sugar, Iodised Salt, Raising Agent (500(ii)). CONTAINS: WHEAT."}


@pytest.fixture(scope="module")
def clean():
    return synth.make(LABEL, "clean", seed=5)


def by_raw(result):
    return {it["raw"]: it for it in result["items"] if it["kind"] in ("ingredient", "statement")}


def test_clean_label_items_and_statuses(clean):
    out = pipeline.read_label([clean], use_claude=False)
    items = by_raw(out)
    assert list(items)[:4] == ["Wheat Flour", "Sugar", "Iodised Salt", "Raising Agent (500(ii))"]
    assert items["CONTAINS: WHEAT"]["kind"] == "statement"
    assert all(it["status"] == fusion.CONFIRMED for it in items.values())
    assert out["allergen_section_uncertain"] is False


def test_cut_off_photo_reports_missing_and_allergen_warning(clean):
    h = clean.shape[0]
    out = pipeline.read_label([clean[: int(h * 0.55)]], use_claude=False)
    assert any(it["kind"] == "missing" for it in out["items"])
    assert out["allergen_section_uncertain"] is True
    assert any("allergens may be missed" in w for w in out["warnings"])


def test_no_statement_is_not_reported_as_safe():
    img = synth.make({"text": "INGREDIENTS: Sugar, Salt, Cocoa Butter."}, "clean", seed=6)
    out = pipeline.read_label([img], use_claude=False)
    assert any("does NOT mean the product has none" in w for w in out["warnings"])


def test_two_overlapping_photos_are_merged_without_duplicates():
    text = "INGREDIENTS: Wheat Flour, Sugar, Palm Oil, Cocoa Solids, Milk Solids, Iodised Salt, Emulsifier (322), Raising Agent (500(ii)), Yeast. CONTAINS: WHEAT, MILK, SOY."
    img = synth.make({"text": text}, "clean", seed=7)
    h = img.shape[0]
    top, bottom = img[: int(h * 0.65)], img[int(h * 0.35):]
    out = pipeline.read_label([top, bottom], use_claude=False)
    raws = [it["raw"] for it in out["items"] if it["kind"] == "ingredient"]
    assert raws.count("Sugar") == 1 and raws.count("Yeast") == 1
    assert "Iodised Salt" in raws


def test_claude_disagreement_becomes_conflict_not_override(clean, monkeypatch):
    monkeypatch.setattr(claude_reader, "is_configured", lambda: True)
    monkeypatch.setattr(claude_reader, "transcribe",
                        lambda img: "INGREDIENTS: Wheat Flour, Sugar, Iodised ⟦?⟧, Raising Agent (500(ii)). CONTAINS: WHEAT, MILK.")
    out = pipeline.read_label([clean], use_claude=True)
    items = by_raw(out)
    assert items["Wheat Flour"]["engines_agree"] is True
    salt = items["Iodised Salt"]
    assert salt["status"] == fusion.UNREADABLE  # Claude couldn't read it: never silently confirmed
    stmt = items["CONTAINS: WHEAT"]
    assert stmt["status"] == fusion.CONFLICTING  # Claude also saw "MILK"; the user decides
    assert stmt["raw"] == "CONTAINS: WHEAT"  # OCR text kept; Claude's extra word is an alternative
    assert any("MILK" in alt for w in stmt["words"] for alt in w["alternatives"])
    assert out["pipeline"]["claude"] is not None


def test_read_endpoint(clean, monkeypatch):
    monkeypatch.setattr(main, "TOKEN", "")
    main._hits.clear()
    body = cv2.imencode(".jpg", clean)[1].tobytes()
    r = TestClient(main.app).post("/read", data={"use_claude": "false"},
                                  files=[("images", ("a.jpg", body, "image/jpeg"))])
    assert r.status_code == 200
    assert r.json()["items"]
    r = TestClient(main.app).post("/read", files=[("images", ("a.jpg", body, "image/jpeg"))] * 5)
    assert r.status_code == 422


def test_comparison_key():
    from app.fusion import _key

    assert _key("(500(ii)).") == _key("(500(ii).") == "500ii"
    assert _key("(3.2%),") == "3.2%"
    assert _key("CONTÁINS:") == "contains"
    # Devanagari vowel signs must survive: चीनी (sugar) is not चिनी.
    assert _key("चीनी") == "चीनी"
    assert _key("चीनी,") != _key("चिनी")
