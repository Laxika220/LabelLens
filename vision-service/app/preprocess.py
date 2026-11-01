"""Preprocessing variants for OCR.

Every variant is computed from the untouched original, never from another
variant's output, so a bad step can't contaminate the others. Which variants
are actually used is decided by measurement (eval/), not by default.

Only classical, deterministic operations are used. Nothing here can invent
characters: upscaling interpolates existing pixels, it does not "imagine"
detail the way generative super-resolution does.
"""

from dataclasses import dataclass
from typing import Callable

import cv2
import numpy as np

from app.imaging import to_bgr, to_gray

TARGET_LINE_HEIGHT = 32  # px; recognisers are trained on ~32-48 px lines
MAX_UPSCALE = 3.0
MAX_SIDE = 4000


@dataclass
class Variant:
    name: str
    image: np.ndarray
    note: str


# ---------- geometry ----------

def rotate(img: np.ndarray, angle_deg: float) -> np.ndarray:
    """Rotate around the centre, enlarging the canvas so no corner is cut."""
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle_deg, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    m[0, 2] += nw / 2 - w / 2
    m[1, 2] += nh / 2 - h / 2
    return cv2.warpAffine(img, m, (nw, nh), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def deskew(img: np.ndarray, skew_deg: float | None) -> np.ndarray | None:
    """Undo a small tilt measured from the text lines' slopes."""
    if skew_deg is None or abs(skew_deg) < 1.0 or abs(skew_deg) > 45:
        return None
    return rotate(img, skew_deg)


def _order_corners(pts: np.ndarray) -> np.ndarray:
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[s.argmin()], pts[d.argmin()], pts[s.argmax()], pts[d.argmax()]], np.float32)


def find_panel(img: np.ndarray, min_area: float = 0.2) -> np.ndarray | None:
    """Find a four-cornered panel (e.g. the printed ingredients box) that
    covers at least `min_area` of the photo. Returns its corners or None."""
    gray = to_gray(img)
    scale = 800 / max(gray.shape)
    small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else gray
    s = scale if scale < 1 else 1.0
    edges = cv2.Canny(cv2.GaussianBlur(small, (5, 5), 0), 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area_total = small.shape[0] * small.shape[1]
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        if cv2.contourArea(c) < min_area * area_total:
            break
        approx = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            return _order_corners(approx.reshape(4, 2).astype(np.float32) / s)
    return None


def warp_panel(img: np.ndarray, corners: np.ndarray) -> np.ndarray:
    tl, tr, br, bl = corners
    w = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    h = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], np.float32)
    return cv2.warpPerspective(img, cv2.getPerspectiveTransform(corners, dst), (w, h), flags=cv2.INTER_CUBIC)


# ---------- photometric ----------

def clahe(img: np.ndarray) -> np.ndarray:
    """Local contrast boost; helps faded print and uneven light."""
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(to_gray(img))


def illumination_normalise(img: np.ndarray) -> np.ndarray:
    """Remove shadows and lighting gradients by dividing by an estimate of
    the background (text removed with a large median blur)."""
    gray = to_gray(img)
    bg = cv2.medianBlur(cv2.dilate(gray, np.ones((7, 7), np.uint8)), 31)
    norm = cv2.divide(gray, bg, scale=255)
    return cv2.normalize(norm, None, 0, 255, cv2.NORM_MINMAX)


def otsu(img: np.ndarray) -> np.ndarray:
    gray = cv2.GaussianBlur(to_gray(img), (3, 3), 0)
    _, out = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return out


def adaptive(img: np.ndarray, line_height: float | None) -> np.ndarray:
    """Local thresholding; window sized to roughly two text-line heights."""
    block = int(2 * (line_height or 20)) | 1
    block = max(11, min(block, 101))
    return cv2.adaptiveThreshold(to_gray(img), 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 10)


def denoise_sharpen(img: np.ndarray) -> np.ndarray:
    gray = cv2.fastNlMeansDenoising(to_gray(img), None, h=7, templateWindowSize=7, searchWindowSize=21)
    blur = cv2.GaussianBlur(gray, (0, 0), 1.2)
    return cv2.addWeighted(gray, 1.6, blur, -0.6, 0)


def upscale(img: np.ndarray, line_height: float | None) -> np.ndarray | None:
    """Enlarge small text towards TARGET_LINE_HEIGHT with bicubic
    interpolation. Returns None when the text is already big enough."""
    if not line_height or line_height >= TARGET_LINE_HEIGHT * 0.8:
        return None
    f = min(MAX_UPSCALE, TARGET_LINE_HEIGHT / line_height)
    h, w = img.shape[:2]
    f = min(f, MAX_SIDE / max(h, w))
    if f < 1.2:
        return None
    return cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)


PHOTOMETRIC: dict[str, tuple[Callable[..., np.ndarray], str]] = {
    "clahe": (lambda im, lh: clahe(im), "CLAHE local contrast"),
    "illum": (lambda im, lh: illumination_normalise(im), "shadow / lighting normalisation"),
    "otsu": (lambda im, lh: otsu(im), "global Otsu binarisation"),
    "adaptive": (lambda im, lh: adaptive(im, lh), "adaptive Gaussian binarisation"),
    "denoise_sharpen": (lambda im, lh: denoise_sharpen(im), "non-local-means denoise + unsharp mask"),
}


def geometric_base(img: np.ndarray, skew_deg: float | None) -> tuple[np.ndarray, list[str]]:
    """Apply the geometry fixes that are clearly safe: perspective warp when a
    panel is found, otherwise deskew. Returns the image and what was done."""
    corners = find_panel(img)
    if corners is not None:
        return warp_panel(img, corners), ["perspective"]
    rotated = deskew(img, skew_deg)
    if rotated is not None:
        return rotated, [f"deskew {skew_deg:.1f}°"]
    return img, []


def variants(
    img: np.ndarray,
    line_height: float | None,
    skew_deg: float | None,
    names: list[str] | None = None,
) -> list[Variant]:
    """Build the requested variants (all by default). 'original' is always first."""
    out = [Variant("original", img, "unchanged photo")]
    base, geo = geometric_base(img, skew_deg)
    if geo:
        out.append(Variant("geometry", base, ", ".join(geo)))
    up = upscale(base, line_height)
    if up is not None:
        out.append(Variant("upscale", up, f"bicubic upscale to ~{TARGET_LINE_HEIGHT}px lines"))
    src = up if up is not None else base
    src_line_height = TARGET_LINE_HEIGHT if up is not None else line_height
    for name, (fn, note) in PHOTOMETRIC.items():
        if names is None or name in names:
            out.append(Variant(name, to_bgr(fn(src, src_line_height)), note))
    if names is not None:
        out = [v for v in out if v.name in names or v.name == "original"]
    return out
