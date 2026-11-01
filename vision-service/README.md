# LabelLens vision service

Python service for the parts of label reading that need OpenCV and OCR models: image-quality assessment, preprocessing, and text recognition. The Next.js server calls it; browsers never call it directly.

## Run locally

```bash
cd vision-service
python3.13 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --port 8001
.venv/bin/python -m pytest -q
```

Set `VISION_SERVICE_TOKEN` to a long random string in production. The Next.js server sends it in the `x-service-token` header.

Memory: about 650 MB peak while reading a photo (RapidOCR PP-OCRv6 small models on ONNX Runtime, measured on an M1). Deploy on an instance with at least 1 GB of RAM.

## Endpoints

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/health` | `{ok: true}` |
| POST | `/assess` | Quality report for one photo (multipart field `image`) |

## How quality is judged

`app/quality.py` finds text lines with the detector, then scores **each line** for:

- **height**: line height in px. Below 16 px, characters start getting lost ("move closer").
- **sharpness**: Laplacian variance divided by intensity variance, so faint-but-sharp print isn't called blurry.
- **contrast**: 5th to 95th percentile spread.
- **glare**: the share of the line where the print has been washed out. White paper alone doesn't count.

Whole-photo checks: text touching an edge (part of the list may be missing), glare patches inside the text area, skew, exposure, and JPEG blockiness. One blurry region doesn't reject the readable ones: the verdict is based on the share of usable lines.

All thresholds are provisional and get checked against OCR accuracy in `eval/`.

## Preprocessing

`app/preprocess.py` builds variants **from the untouched original**: geometry fix (perspective warp of a detected panel, or deskew), bicubic upscale when the text is small, CLAHE, shadow/illumination normalisation, Otsu, adaptive threshold, and denoise + sharpen. No generative enhancement is used, so no step can invent characters. Which variants are worth running is decided by measurement (milestone 3/5).

## Synthetic benchmark

`python -m eval.synth` renders 24 realistic Indian-style ingredient lists × 15 conditions (clean, small font, low resolution, blur, motion blur, JPEG, glare, shadow, rotation, perspective, curved pack, faded print, patterned background, dense text, combined) = 360 images with exact ground truth. It is used to compare techniques. It is not evidence of real-world accuracy.
