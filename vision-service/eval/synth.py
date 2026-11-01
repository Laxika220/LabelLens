"""Generate a synthetic, degraded ingredient-label benchmark.

Why synthetic? It gives exact ground truth and lets us change ONE condition
at a time (blur, glare, curvature...), which is what's needed to decide
whether a preprocessing step really helps. It is NOT a substitute for real
photos: real-world accuracy is only reported from eval/real/ (see README).

Usage:  .venv/bin/python -m eval.synth [--out eval/synthetic]
Images are deterministic (fixed seeds), so they aren't committed to git.
"""

import argparse
import json
import random
import textwrap
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
FONTS = {
    "arial": "/System/Library/Fonts/Supplemental/Arial.ttf",
    "arial_narrow": "/System/Library/Fonts/Supplemental/Arial Narrow.ttf",
    "helvetica": "/System/Library/Fonts/Helvetica.ttc",
    "verdana": "/System/Library/Fonts/Supplemental/Verdana.ttf",
    "georgia": "/System/Library/Fonts/Supplemental/Georgia.ttf",
}

CATEGORIES = [
    "clean", "small_font", "low_res", "blur", "motion_blur", "jpeg", "glare",
    "shadow", "rotated", "perspective", "curved", "faded", "pattern", "dense", "combo",
]


def render_panel(text: str, font_path: str, size: int, width_chars: int, fg, bg, leading=1.25) -> np.ndarray:
    font = ImageFont.truetype(font_path, size)
    lines = textwrap.wrap(text, width=width_chars)
    line_h = int(size * leading)
    w = int(max(font.getlength(line) for line in lines)) + 2 * size
    h = line_h * len(lines) + 2 * size
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    for i, line in enumerate(lines):
        d.text((size, size + i * line_h), line, font=font, fill=fg)
    d.rectangle([2, 2, w - 3, h - 3], outline=fg, width=max(2, size // 8))
    return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)


def on_package(panel: np.ndarray, rng: random.Random, color=(40, 90, 170), margin=0.18) -> np.ndarray:
    h, w = panel.shape[:2]
    mh, mw = int(h * margin) + 20, int(w * margin) + 20
    canvas = np.zeros((h + 2 * mh, w + 2 * mw, 3), np.uint8)
    canvas[:] = color
    noise = np.random.default_rng(rng.randint(0, 9999)).normal(0, 6, canvas.shape)
    canvas = np.clip(canvas + noise, 0, 255).astype(np.uint8)
    canvas[mh:mh + h, mw:mw + w] = panel
    return canvas


def gaussian_blur(img, sigma):
    return cv2.GaussianBlur(img, (0, 0), sigma)


def motion_blur(img, length=9, angle=15):
    k = np.zeros((length, length), np.float32)
    k[length // 2, :] = 1
    m = cv2.getRotationMatrix2D((length / 2 - 0.5, length / 2 - 0.5), angle, 1)
    k = cv2.warpAffine(k, m, (length, length))
    return cv2.filter2D(img, -1, k / k.sum())


def jpeg(img, q):
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def glare(img, rng):
    h, w = img.shape[:2]
    cx, cy = rng.uniform(0.3, 0.7) * w, rng.uniform(0.3, 0.7) * h
    yy, xx = np.mgrid[0:h, 0:w]
    d = ((xx - cx) / (0.22 * w)) ** 2 + ((yy - cy) / (0.12 * h)) ** 2
    mask = np.clip(1.3 * np.exp(-d), 0, 1)[..., None]
    return np.clip(img * (1 - mask) + 255 * mask, 0, 255).astype(np.uint8)


def shadow(img, rng):
    h, w = img.shape[:2]
    ramp = np.linspace(rng.uniform(0.25, 0.4), 1.0, w)[None, :, None]
    if rng.random() < 0.5:
        ramp = ramp[:, ::-1]
    return (img * ramp).astype(np.uint8)


def rotate(img, deg):
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1)
    return cv2.warpAffine(img, m, (w, h), borderMode=cv2.BORDER_REPLICATE)


def perspective(img, rng):
    h, w = img.shape[:2]
    j = lambda s: rng.uniform(0.04, 0.12) * s  # noqa: E731
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[j(w), j(h)], [w - j(w) * 0.3, 0], [w, h - j(h)], [j(w) * 0.5, h]])
    return cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (w, h), borderMode=cv2.BORDER_REPLICATE)


def curved(img, strength=0.55):
    """Cylindrical (bottle/jar) warp: text compresses and darkens toward the sides."""
    h, w = img.shape[:2]
    xs = np.linspace(-1, 1, w)
    theta = np.arcsin(np.clip(xs * np.sin(strength * np.pi / 2), -1, 1)) / np.sin(strength * np.pi / 2)
    map_x = ((theta + 1) / 2 * (w - 1)).astype(np.float32)
    map_x = np.repeat(map_x[None, :], h, axis=0)
    bulge = (np.cos(xs * np.pi / 2) * 0.04 * h)[None, :]
    map_y = (np.arange(h, dtype=np.float32)[:, None] + bulge * (np.arange(h)[:, None] / h - 0.5)).astype(np.float32)
    out = cv2.remap(img, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    shade = (0.55 + 0.45 * np.cos(xs * np.pi / 2))[None, :, None]
    return (out * shade).astype(np.uint8)


def textured_bg(h, w, rng):
    base = np.array([rng.randint(150, 230), rng.randint(120, 220), rng.randint(60, 140)], np.uint8)
    yy, xx = np.mgrid[0:h, 0:w]
    stripes = ((np.sin(xx / rng.uniform(6, 14) + yy / rng.uniform(9, 20)) + 1) * 18).astype(np.int16)
    img = np.clip(base[None, None, :].astype(np.int16) - stripes[..., None], 0, 255)
    return img.astype(np.uint8)


def make(label: dict, category: str, seed: int) -> np.ndarray:
    rng = random.Random(seed)
    text = label["text"]
    font = FONTS[rng.choice(["arial", "helvetica", "verdana", "georgia"])]
    size, width, fg, bg = 30, 52, (25, 25, 25), (250, 248, 240)

    if category == "small_font":
        size = 15
    elif category == "dense":
        font, size, width = FONTS["arial_narrow"], 22, 78
    elif category == "faded":
        fg, bg = (150, 150, 140), (236, 232, 220)

    if category == "pattern":
        panel = render_panel(text, font, size, width, (255, 255, 255), (0, 0, 0))
        mask = cv2.cvtColor(panel, cv2.COLOR_BGR2GRAY) > 128
        bgimg = textured_bg(*panel.shape[:2], rng)
        panel = bgimg.copy()
        panel[mask] = (20, 20, 90)
    else:
        panel = render_panel(text, font, size, width, fg, bg, leading=1.12 if category == "dense" else 1.25)

    img = on_package(panel, rng)

    if category == "low_res":
        img = cv2.resize(img, None, fx=0.42, fy=0.42, interpolation=cv2.INTER_AREA)
    elif category == "blur":
        img = gaussian_blur(img, 2.2)
    elif category == "motion_blur":
        img = motion_blur(img, 11, rng.uniform(-20, 20))
    elif category == "jpeg":
        img = jpeg(cv2.resize(img, None, fx=0.6, fy=0.6, interpolation=cv2.INTER_AREA), 18)
    elif category == "glare":
        img = glare(img, rng)
    elif category == "shadow":
        img = shadow(img, rng)
    elif category == "rotated":
        img = rotate(img, rng.choice([-1, 1]) * rng.uniform(8, 18))
    elif category == "perspective":
        img = perspective(img, rng)
    elif category == "curved":
        img = curved(img)
    elif category == "combo":
        img = rotate(shadow(img, rng), rng.uniform(-6, 6))
        img = jpeg(gaussian_blur(img, 1.3), 35)

    if category not in ("jpeg", "combo"):
        img = jpeg(img, 88)  # every phone photo is a JPEG
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "synthetic"))
    args = ap.parse_args()
    out = Path(args.out)
    (out / "images").mkdir(parents=True, exist_ok=True)
    labels = json.loads((ROOT / "data" / "synthetic_labels.json").read_text())
    manifest = []
    for li, label in enumerate(labels):
        for ci, cat in enumerate(CATEGORIES):
            name = f"{label['id']}__{cat}.jpg"
            img = make(label, cat, seed=li * 100 + ci)
            cv2.imwrite(str(out / "images" / name), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
            manifest.append({"image": f"images/{name}", "label_id": label["id"], "category": cat,
                             "text": label["text"], "allergens": label["allergens"], "language": "en"})
    (out / "manifest.jsonl").write_text("\n".join(json.dumps(m) for m in manifest) + "\n")
    print(f"wrote {len(manifest)} images to {out}")


if __name__ == "__main__":
    main()
