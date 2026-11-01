"""Image-quality assessment for ingredient-label photos.

Quality is judged per text region (each line the detector finds) as well as
for the whole photo, so one blurry corner of a curved jar doesn't cause the
readable part to be rejected.

All thresholds below are starting values. They are re-checked against OCR
accuracy in the evaluation (eval/), and the numbers are reported there.
"""

from dataclasses import asdict, dataclass, field

import cv2
import numpy as np

from app import ocr
from app.imaging import to_gray

# --- Thresholds (provisional; see eval/report for how they were checked) ---
MIN_LINE_HEIGHT = 16  # px. Below this, recognisers start losing characters.
GOOD_LINE_HEIGHT = 28  # px. Upscaling beyond this rarely helps.
BLUR_SHARPNESS = 0.35  # normalised sharpness below this = blurry region
LOW_CONTRAST = 0.25  # (p95 - p5) / 255
GLARE_PIXEL = 254  # luminance treated as clipped (white paper is usually below this)
WASHED_CONTRAST = 0.15  # a line segment brighter than WASHED_MEAN with less contrast than this is washed out
WASHED_MEAN = 215
GLARE_REGION_FRACTION = 0.10  # share of washed-out segments that makes a line "glare"
GLARE_BLOB_MIN_AREA = 0.002  # clipped spots smaller than this share of the image are ignored
DARK_P95 = 90
EDGE_MARGIN = 0.012  # text this close to the border may be cut off
SKEW_WARN_DEG = 12
BLOCKINESS_WARN = 1.6


@dataclass
class Region:
    box: list[list[int]]
    height: float
    sharpness: float
    contrast: float
    glare: float  # share of the line washed out by glare
    issues: list[str] = field(default_factory=list)


@dataclass
class Report:
    width: int
    height: int
    text_lines: int
    median_line_height: float | None
    skew_deg: float | None
    blockiness: float
    exposure: dict
    regions: list[Region]
    glare_blobs: list[list[int]]  # [x, y, w, h] areas where glare may hide text
    cut_off_edges: list[str]  # "top" | "bottom" | "left" | "right"
    usable_fraction: float  # share of text regions with no blocking issue
    verdict: str  # "good" | "usable" | "retake"
    advice: list[str]

    def to_dict(self):
        return asdict(self)


def sharpness(gray: np.ndarray) -> float:
    """Contrast-normalised focus measure.

    Laplacian variance rises with both focus and contrast, so a sharp but
    faint print could look "blurry". Dividing by the region's intensity
    variance removes most of the contrast effect.

    Measured on a synthetic 37 px text line: crisp ~24, Gaussian blur
    sigma 1.2 -> 2.9, sigma 2.2 -> 0.56, sigma 3.0 -> 0.19. The value also
    depends on text size, so the threshold is calibrated against OCR
    errors in eval/, not fixed by these numbers.
    """
    g = gray.astype(np.float32)
    var = float(g.var())
    if var < 1e-3:
        return 0.0
    return float(cv2.Laplacian(g, cv2.CV_32F, ksize=3).var() / var)


def contrast(gray: np.ndarray) -> float:
    p5, p95 = np.percentile(gray, [5, 95])
    return float((p95 - p5) / 255.0)


def blockiness(gray: np.ndarray) -> float:
    """JPEG 8x8 block artefact strength: ratio of pixel jumps on block
    boundaries to jumps elsewhere. ~1.0 = none, >1.5 = visible blocks."""
    g = gray.astype(np.float32)
    dx = np.abs(np.diff(g, axis=1))
    cols = np.arange(dx.shape[1])
    on = dx[:, cols % 8 == 7].mean()
    off = dx[:, cols % 8 != 7].mean()
    return float(on / off) if off > 1e-3 else 1.0


def _crop(gray: np.ndarray, box: list[list[int]], pad: int = 2) -> np.ndarray:
    pts = np.array(box)
    x0, y0 = np.maximum(pts.min(axis=0) - pad, 0)
    x1, y1 = pts.max(axis=0) + pad
    return gray[y0:y1, x0:x1]


def washed_segments(crop: np.ndarray, line_height: float) -> tuple[int, int]:
    """Count segments of a text line that are washed out by glare.

    The line is cut into segments about one line-height wide. A segment
    with real print has dark strokes on a lighter background (high
    contrast); a segment under a specular highlight is uniformly bright.
    Plain white paper is NOT glare as long as the print on it is visible.
    The detector pads each box, so the blank ends are trimmed first.
    Returns (washed, total).
    """
    pad = int(line_height * 0.4)
    if crop.shape[1] > 4 * pad:
        crop = crop[:, pad:-pad]
    step = max(8, int(line_height))
    cells = [crop[:, x:x + step] for x in range(0, crop.shape[1] - step // 2, step)]
    washed = sum(
        1 for c in cells
        if c.mean() > WASHED_MEAN and (np.percentile(c, 95) - np.percentile(c, 5)) / 255 < WASHED_CONTRAST
    )
    return washed, len(cells)


def _glare_blobs(gray: np.ndarray, boxes, line_height: float) -> list[list[int]]:
    """Solid clipped areas inside the text area, where print may be hidden
    (the detector can't find lines that glare has erased completely).

    An opening with a kernel about half a text line wide keeps only solid
    bright patches; the thin clipped specks that JPEG ringing leaves
    between small letters are removed."""
    if not boxes:
        return []
    pts = np.array([p for b in boxes for p in b])
    x0, y0 = np.maximum(pts.min(axis=0), 0)
    x1, y1 = pts.max(axis=0)
    mask = np.zeros_like(gray, np.uint8)
    mask[y0:y1, x0:x1] = gray[y0:y1, x0:x1] >= GLARE_PIXEL
    k = max(5, int(line_height * 0.5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    min_area = GLARE_BLOB_MIN_AREA * gray.size
    return [
        [int(x), int(y), int(w), int(h)]
        for x, y, w, h, area in stats[1:n]
        if area >= min_area
    ]


def _cut_off(boxes, w: int, h: int) -> list[str]:
    if not boxes:
        return []
    pts = np.array([p for b in boxes for p in b])
    mx, my = EDGE_MARGIN * w, EDGE_MARGIN * h
    edges = []
    if pts[:, 1].min() <= my:
        edges.append("top")
    if pts[:, 1].max() >= h - my:
        edges.append("bottom")
    if pts[:, 0].min() <= mx:
        edges.append("left")
    if pts[:, 0].max() >= w - mx:
        edges.append("right")
    return edges


def assess(img: np.ndarray, boxes: list[list[list[int]]] | None = None) -> Report:
    gray = to_gray(img)
    h, w = gray.shape
    if boxes is None:
        boxes = ocr.detect(img)

    regions: list[Region] = []
    for box in boxes:
        crop = _crop(gray, box)
        if crop.size < 20:
            continue
        line = ocr.Line(text="", score=0.0, box=box)
        r = Region(
            box=box,
            height=round(line.height, 1),
            sharpness=round(sharpness(crop), 3),
            contrast=round(contrast(crop), 3),
            glare=0.0,
        )
        washed, cells = washed_segments(crop, line.height)
        r.glare = round(washed / cells, 3) if cells else 0.0
        if r.height < MIN_LINE_HEIGHT:
            r.issues.append("small")
        if r.sharpness < BLUR_SHARPNESS:
            r.issues.append("blurry")
        if r.contrast < LOW_CONTRAST:
            r.issues.append("low_contrast")
        if washed >= 2 and r.glare > GLARE_REGION_FRACTION:
            r.issues.append("glare")
        regions.append(r)

    heights = [r.height for r in regions]
    median_h = float(np.median(heights)) if heights else None
    angles = [ocr.Line("", 0, b).angle for b in boxes]
    skew = float(np.median(angles)) if angles else None
    p95 = float(np.percentile(gray, 95))
    exposure = {
        "mean": round(float(gray.mean()), 1),
        "p5": float(np.percentile(gray, 5)),
        "p95": p95,
        "clipped_bright": round(float((gray >= GLARE_PIXEL).mean()), 4),
        "clipped_dark": round(float((gray <= 5).mean()), 4),
    }
    blobs = _glare_blobs(gray, boxes, median_h or 20)
    edges = _cut_off(boxes, w, h)
    block = round(blockiness(gray), 2)

    blocking = {"blurry", "glare", "small"}
    usable = [r for r in regions if not blocking & set(r.issues)]
    usable_fraction = round(len(usable) / len(regions), 2) if regions else 0.0

    advice = _advice(regions, median_h, skew, p95, blobs, edges, block)
    if not regions:
        verdict = "retake"
    elif usable_fraction >= 0.9 and not edges and not blobs:
        verdict = "good"
    elif usable_fraction >= 0.5:
        verdict = "usable"
    else:
        verdict = "retake"

    return Report(
        width=w,
        height=h,
        text_lines=len(regions),
        median_line_height=round(median_h, 1) if median_h else None,
        skew_deg=round(skew, 1) if skew is not None else None,
        blockiness=block,
        exposure=exposure,
        regions=regions,
        glare_blobs=blobs,
        cut_off_edges=edges,
        usable_fraction=usable_fraction,
        verdict=verdict,
        advice=advice,
    )


def _advice(regions, median_h, skew, p95, blobs, edges, block) -> list[str]:
    if not regions:
        if p95 < DARK_P95:
            return ["It's too dark to find any text. Turn on more light or the torch."]
        return ["No text found. Point the camera at the ingredients list and move closer."]

    tips: list[str] = []
    n = len(regions)
    share = lambda issue: sum(issue in r.issues for r in regions) / n  # noqa: E731

    if share("blurry") > 0.5:
        tips.append("Most of the text is out of focus. Hold the phone steady and tap the text to focus.")
    elif share("blurry") > 0.1:
        tips.append("Part of the label is out of focus (common on curved packs). Take an extra photo of the blurry part.")
    if median_h is not None and median_h < MIN_LINE_HEIGHT:
        tips.append("The text is very small in this photo. Move closer so the ingredients fill the frame.")
    elif share("small") > 0.2:
        tips.append("Some lines are too small to read reliably. Move a little closer.")
    if share("glare") > 0 or blobs:
        tips.append("Glare is covering part of the label. Tilt the packet or move away from the light.")
    if p95 < DARK_P95:
        tips.append("The photo is dark. Find better light or turn on the torch.")
    if share("low_contrast") > 0.3:
        tips.append("The print is faint against its background. Try even, brighter light.")
    for edge in edges:
        tips.append(f"Text touches the {edge} edge of the photo, so part of the list may be missing. Capture the {edge} section too.")
    if skew is not None and abs(skew) > SKEW_WARN_DEG:
        tips.append("The photo is tilted. It will be straightened, but holding the phone level gives better results.")
    if block > BLOCKINESS_WARN:
        tips.append("The image is heavily compressed. Use the original photo rather than a forwarded or screenshot copy.")
    return tips
