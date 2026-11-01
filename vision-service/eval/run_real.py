"""Score the full pipeline on real photos (eval/real/labels.jsonl).

Reports, overall and per condition/language:
- CER / WER and ingredient precision/recall of the final reading,
- the same for RapidOCR on the first photo alone (baseline),
- allergen-term recall,
- error flagging: of the words that are wrong, how many were NOT marked
  confirmed (and how many wrong words were silently "confirmed").

Usage:  .venv/bin/python -m eval.run_real [--no-claude]
"""

import argparse
import json
from collections import defaultdict
from pathlib import Path
from statistics import mean

import cv2

from app import ocr, pipeline
from eval import metrics
from eval.analyse import word_correctness

ROOT = Path(__file__).parent / "real"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-claude", action="store_true")
    args = ap.parse_args()
    labels_path = ROOT / "labels.jsonl"
    if not labels_path.exists():
        raise SystemExit(f"No {labels_path}. See eval/real/README.md for how to build the real-photo set.")
    labels = [json.loads(line) for line in labels_path.read_text().splitlines() if line.strip()]

    rows = []
    for lab in labels:
        imgs = [cv2.imread(str(ROOT / p)) for p in lab["images"]]
        if any(i is None for i in imgs):
            print(f"skip {lab['id']}: missing image")
            continue
        out = pipeline.read_label(imgs, use_claude=not args.no_claude)
        read_items = [it for it in out["items"] if it["kind"] in ("ingredient", "statement")]
        final_text = "INGREDIENTS: " + ", ".join(it["raw"] for it in read_items if it["kind"] == "ingredient") + ". " + \
            ". ".join(it["raw"] for it in read_items if it["kind"] == "statement")
        words = [w for it in read_items for w in it["words"]]
        ok = word_correctness([w["text"] for w in words], lab["text"])
        wrong = [w for w, good in zip(words, ok) if not good]
        base_text = " ".join(ln.text for ln in ocr.read(imgs[0]))
        rows.append({
            "id": lab["id"],
            "conditions": lab.get("conditions", []) + [f"lang:{lab.get('language', '?')}"],
            "pipeline": metrics.score(final_text, lab["text"], lab.get("allergens", [])),
            "rapidocr_first_photo": metrics.score(base_text, lab["text"], lab.get("allergens", [])),
            "words": len(words),
            "wrong_words": len(wrong),
            "wrong_flagged": sum(w["status"] != "confirmed" for w in wrong),
            "flagged": sum(w["status"] != "confirmed" for w in words),
            "allergen_warning_shown": out["allergen_section_uncertain"],
            "claude_used": out["pipeline"]["claude"] is not None,
        })
        print(f"{lab['id']}: CER {rows[-1]['pipeline']['cer']:.3f}")

    if not rows:
        raise SystemExit("no usable labels")
    groups = defaultdict(list)
    for r in rows:
        groups["ALL"].append(r)
        for c in r["conditions"]:
            groups[c].append(r)

    def m(rs, sys, k):
        vals = [r[sys][k] for r in rs if r[sys][k] is not None]
        return mean(float(v) for v in vals) if vals else None

    lines = [f"# Real-photo evaluation ({len(rows)} labels)\n",
             "Ground truth typed from the physical packs. "
             f"AI cross-check used: {sum(r['claude_used'] for r in rows)}/{len(rows)} labels.\n",
             "| group | labels | CER pipeline | CER RapidOCR alone | ingredient recall | ingredient precision | allergen-term recall | wrong words flagged | silent errors |",
             "|---|---|---|---|---|---|---|---|---|"]
    for g, rs in sorted(groups.items(), key=lambda kv: (kv[0] != "ALL", kv[0])):
        wrong = sum(r["wrong_words"] for r in rs)
        flagged = sum(r["wrong_flagged"] for r in rs)
        f = lambda x: "–" if x is None else f"{x:.3f}"  # noqa: E731
        p = lambda x: "–" if x is None else f"{x * 100:.1f}%"  # noqa: E731
        lines.append(f"| {g} | {len(rs)} | {f(m(rs, 'pipeline', 'cer'))} | {f(m(rs, 'rapidocr_first_photo', 'cer'))} | "
                     f"{p(m(rs, 'pipeline', 'ing_recall'))} | {p(m(rs, 'pipeline', 'ing_precision'))} | {p(m(rs, 'pipeline', 'allergen_recall'))} | "
                     f"{p(flagged / wrong if wrong else None)} | {wrong - flagged} |")
    out_dir = Path(__file__).parent / "results"
    out_dir.mkdir(exist_ok=True)
    (out_dir / "real_report.md").write_text("\n".join(lines) + "\n")
    (out_dir / "real_rows.json").write_text(json.dumps(rows, indent=1))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
