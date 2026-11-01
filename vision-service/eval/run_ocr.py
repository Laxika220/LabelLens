"""Run RapidOCR on every benchmark image and every preprocessing variant.

Saves raw per-line output (text, score, box) so different ways of choosing
or combining variants can be evaluated afterwards without re-running OCR.
Resumable: images already in the output file are skipped.

Usage:  .venv/bin/python -m eval.run_ocr [--set synthetic] [--labels 24]
"""

import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np

from app import ocr, preprocess, quality

ROOT = Path(__file__).parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="synthetic")
    ap.add_argument("--labels", type=int, default=0, help="limit to the first N label ids (0 = all)")
    args = ap.parse_args()

    base = ROOT / args.set
    rows = [json.loads(line) for line in (base / "manifest.jsonl").read_text().splitlines() if line]
    if args.labels:
        keep = list(dict.fromkeys(r["label_id"] for r in rows))[: args.labels]
        rows = [r for r in rows if r["label_id"] in keep]

    out_path = ROOT / "results" / "raw" / f"{args.set}_rapidocr.jsonl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    done = set()
    if out_path.exists():
        done = {json.loads(line)["image"] for line in out_path.read_text().splitlines() if line}

    ocr.engine()
    with out_path.open("a") as f:
        for i, r in enumerate(rows):
            if r["image"] in done:
                continue
            img = cv2.imread(str(base / r["image"]))
            rep = quality.assess(img)
            sharp = [reg.sharpness for reg in rep.regions]
            rec = {
                "image": r["image"],
                "quality": {
                    "verdict": rep.verdict,
                    "usable_fraction": rep.usable_fraction,
                    "median_line_height": rep.median_line_height,
                    "median_sharpness": float(np.median(sharp)) if sharp else None,
                    "skew_deg": rep.skew_deg,
                    "glare_blobs": len(rep.glare_blobs),
                    "cut_off_edges": rep.cut_off_edges,
                },
                "variants": {},
            }
            for v in preprocess.variants(img, rep.median_line_height, rep.skew_deg):
                t = time.time()
                lines = ocr.read(v.image)
                rec["variants"][v.name] = {
                    "seconds": round(time.time() - t, 2),
                    "shape": list(v.image.shape[:2]),
                    "lines": [{"text": ln.text, "score": round(ln.score, 4), "box": ln.box} for ln in lines],
                }
            f.write(json.dumps(rec) + "\n")
            f.flush()
            print(f"[{i + 1}/{len(rows)}] {r['image']}", flush=True)


if __name__ == "__main__":
    main()
