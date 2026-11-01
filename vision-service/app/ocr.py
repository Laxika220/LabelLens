"""RapidOCR wrapper (PaddleOCR PP-OCRv6 models running on ONNX Runtime).

Two choices here matter for honesty:
- text_score=0 keeps every recognised line. RapidOCR's default (0.5) silently
  drops low-scoring lines, which would hide text instead of flagging it.
- Scores are kept as raw engine scores. They are NOT probabilities of being
  correct; calibration happens in the evaluation step.
"""

from dataclasses import dataclass
from functools import lru_cache

import cv2
import numpy as np

from app.imaging import to_bgr


@dataclass
class Line:
    text: str
    score: float  # raw recogniser score, uncalibrated
    box: list[list[int]]  # 4 corner points [x, y] in the input image's pixels

    @property
    def height(self) -> float:
        """Text-line height in pixels (short side of the rotated box)."""
        (_, _), (w, h), _ = cv2.minAreaRect(np.array(self.box, np.float32))
        return float(min(w, h))

    @property
    def angle(self) -> float:
        """Slope of the line's top edge in degrees (0 = horizontal)."""
        (x0, y0), (x1, y1) = self.box[0], self.box[1]
        return float(np.degrees(np.arctan2(y1 - y0, x1 - x0)))


@lru_cache(maxsize=1)
def engine():
    from rapidocr import RapidOCR

    return RapidOCR(
        params={
            "Global.text_score": 0.0,
            "Global.log_level": "warning",
            # Allow larger inputs before RapidOCR shrinks them; small print
            # needs the pixels.
            "Global.max_side_len": 4000,
        }
    )


def detect(img: np.ndarray) -> list[list[list[int]]]:
    """Text-line boxes only (no recognition). Fast enough for quality checks."""
    out = engine()(to_bgr(img), use_det=True, use_cls=False, use_rec=False)
    boxes = getattr(out, "boxes", None)
    return [] if boxes is None else np.asarray(boxes).round().astype(int).tolist()


def read(img: np.ndarray) -> list[Line]:
    """Detect, orientation-classify and recognise text lines."""
    out = engine()(to_bgr(img))
    if out.boxes is None or out.txts is None:
        return []
    return [
        Line(text=t, score=float(s), box=np.asarray(b).round().astype(int).tolist())
        for b, t, s in zip(out.boxes, out.txts, out.scores)
    ]
