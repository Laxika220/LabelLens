"""Decoding and validating uploaded photos.

Images are decoded straight from memory and never written to disk.
"""

import cv2
import numpy as np

MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 40_000_000
MIN_SIDE = 200


class ImageError(ValueError):
    """The upload is not a usable image. The message is safe to show users."""


def decode(data: bytes) -> np.ndarray:
    """Return a BGR image. EXIF orientation is applied by OpenCV on decode."""
    if len(data) > MAX_BYTES:
        raise ImageError("Photo is larger than 12 MB.")
    buf = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise ImageError("Could not read this file as an image.")
    h, w = img.shape[:2]
    if h * w > MAX_PIXELS:
        raise ImageError("Photo resolution is too high (over 40 megapixels).")
    if min(h, w) < MIN_SIDE:
        raise ImageError("Photo is too small to read (under 200 pixels on one side).")
    return img


def to_gray(img: np.ndarray) -> np.ndarray:
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def to_bgr(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR) if img.ndim == 2 else img


def encode_jpeg(img: np.ndarray, quality: int = 90) -> bytes:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("JPEG encode failed")
    return buf.tobytes()
