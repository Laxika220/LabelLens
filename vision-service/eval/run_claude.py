"""Benchmark Claude's verbatim transcription on the synthetic set.

Needs ANTHROPIC_API_KEY. Costs money: about 360 vision requests. Results
are saved to results/raw/synthetic_claude.jsonl and picked up by analyse.

Usage:  .venv/bin/python -m eval.run_claude [--limit N]
"""

import argparse
import json
from pathlib import Path

import cv2

from app import claude_reader

ROOT = Path(__file__).parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    if not claude_reader.is_configured():
        raise SystemExit("ANTHROPIC_API_KEY is not set.")
    rows = [json.loads(line) for line in (ROOT / "synthetic" / "manifest.jsonl").read_text().splitlines() if line]
    if args.limit:
        rows = rows[: args.limit]
    out = ROOT / "results" / "raw" / "synthetic_claude.jsonl"
    done = {json.loads(line)["image"] for line in out.read_text().splitlines()} if out.exists() else set()
    with out.open("a") as f:
        for r in rows:
            if r["image"] in done:
                continue
            text = claude_reader.transcribe(cv2.imread(str(ROOT / "synthetic" / r["image"])))
            f.write(json.dumps({"image": r["image"], "model": claude_reader.MODEL,
                                "prompt": claude_reader.PROMPT_VERSION, "text": text}) + "\n")
            f.flush()
            print(r["image"])


if __name__ == "__main__":
    main()
