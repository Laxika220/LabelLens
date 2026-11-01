"""Quality-assessment and preprocessing tests on rendered labels.

The images are generated with the same code as the evaluation set, so the
tests need no stored photos.
"""

import random

import cv2
import numpy as np
import pytest

from app import preprocess, quality
from eval import synth

LABEL = {"text": "INGREDIENTS: Sugar, Milk Solids (24%), Cocoa Butter, Emulsifiers (Soya Lecithin, 476). CONTAINS MILK, SOY."}


@pytest.fixture(scope="module")
def clean():
    return synth.make(LABEL, "clean", seed=1)


def test_clean_photo_is_good(clean):
    r = quality.assess(clean)
    assert r.verdict == "good"
    assert r.text_lines >= 2
    assert r.glare_blobs == []
    assert r.advice == []


def test_white_paper_is_not_glare(clean):
    r = quality.assess(clean)
    assert all("glare" not in reg.issues for reg in r.regions)


def test_glare_is_flagged_with_specific_advice():
    r = quality.assess(synth.make(LABEL, "glare", seed=3))
    assert r.glare_blobs
    assert any("Glare" in tip for tip in r.advice)


def test_heavy_blur_is_flagged(clean):
    r = quality.assess(cv2.GaussianBlur(clean, (0, 0), 3.5), quality.assess(clean).regions and [reg.box for reg in quality.assess(clean).regions])
    assert all("blurry" in reg.issues for reg in r.regions)
    assert r.verdict == "retake"


def test_partial_blur_keeps_readable_regions(clean):
    """A blurry half must not cause the sharp half to be rejected."""
    boxes = [reg.box for reg in quality.assess(clean).regions]
    img = clean.copy()
    h = img.shape[0]
    img[h // 2:] = cv2.GaussianBlur(img, (0, 0), 3.5)[h // 2:]
    r = quality.assess(img, boxes)
    states = ["blurry" in reg.issues for reg in r.regions]
    assert any(states) and not all(states)
    assert any("Part of the label is out of focus" in tip for tip in r.advice)


def test_cut_off_text_is_reported(clean):
    h = clean.shape[0]
    cropped = clean[int(h * 0.45):]  # top part of the list missing
    r = quality.assess(cropped)
    assert "top" in r.cut_off_edges
    assert any("top section" in tip for tip in r.advice)


def test_small_text_advises_moving_closer(clean):
    small = cv2.resize(clean, None, fx=0.33, fy=0.33, interpolation=cv2.INTER_AREA)
    r = quality.assess(small)
    assert any("Move" in tip and "closer" in tip for tip in r.advice)


def test_no_text_found():
    blank = np.full((600, 800, 3), 128, np.uint8)
    r = quality.assess(blank)
    assert r.verdict == "retake" and r.advice


def test_skew_is_measured_and_corrected(clean):
    tilted = synth.rotate(clean, 10)
    r = quality.assess(tilted)
    assert r.skew_deg is not None and 7 < abs(r.skew_deg) < 13
    fixed = preprocess.deskew(tilted, r.skew_deg)
    assert abs(quality.assess(fixed).skew_deg) < 2


def test_variants_start_from_original_and_keep_it(clean):
    vs = preprocess.variants(clean, line_height=36, skew_deg=0)
    assert vs[0].name == "original" and vs[0].image is clean
    assert {"clahe", "illum", "otsu", "adaptive", "denoise_sharpen"} <= {v.name for v in vs}
    assert all(v.image.ndim == 3 for v in vs)


def test_upscale_only_when_text_is_small(clean):
    assert preprocess.upscale(clean, 40) is None
    up = preprocess.upscale(clean, 12)
    assert up is not None and up.shape[0] > clean.shape[0] * 2


def test_perspective_panel_is_found():
    rng = random.Random(4)
    img = synth.perspective(synth.make(LABEL, "clean", seed=4), rng)
    corners = preprocess.find_panel(img)
    assert corners is not None
    warped = preprocess.warp_panel(img, corners)
    assert warped.shape[0] > 50 and warped.shape[1] > 50


def test_read_after_detect_still_recognises(clean):
    """Regression: RapidOCR keeps flags between calls on the shared engine."""
    from app import ocr

    ocr.detect(clean)
    lines = ocr.read(clean)
    assert lines and "sugar" in " ".join(line.text for line in lines).lower()


def test_variant_boxes_map_back_to_original(clean):
    """Text found in a deskewed + upscaled variant lands on the same spot of the original."""
    from app import ocr

    small_tilted = synth.rotate(cv2.resize(clean, None, fx=0.5, fy=0.5), 6)
    rep = quality.assess(small_tilted)
    vs = {v.name: v for v in preprocess.variants(small_tilted, rep.median_line_height, rep.skew_deg)}
    v = vs.get("upscale") or vs["geometry"]
    orig_lines = ocr.read(small_tilted)
    var_lines = ocr.read(v.image)
    o = np.array(orig_lines[0].box).mean(axis=0)
    mapped = np.array([np.array(v.to_original(ln.box)).mean(axis=0) for ln in var_lines])
    assert np.min(np.linalg.norm(mapped - o, axis=1)) < 15
