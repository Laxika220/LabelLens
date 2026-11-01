"""Turn raw OCR runs into the accuracy report.

Reads eval/results/raw/<set>_rapidocr.jsonl (and _tesseract.jsonl if
present) plus the ground truth, and writes eval/results/<set>_report.md and
<set>_summary.json.

Honesty rules built in:
- Thresholds (score cut-offs, which variants to fuse) are chosen on the
  TRAIN half of the labels and reported on the TEST half.
- "Oracle" numbers (best variant chosen with knowledge of the answer) are
  shown only as an upper bound and labelled as such.

Usage:  .venv/bin/python -m eval.analyse [--set synthetic]
"""

import argparse
import json
from collections import defaultdict
from difflib import SequenceMatcher
from itertools import combinations
from pathlib import Path
from statistics import mean, median

import cv2

from app import fusion, lexicon, preprocess
from eval import metrics

ROOT = Path(__file__).parent
METRIC_KEYS = ["cer", "wer", "ing_recall", "ing_precision", "exact_list", "allergen_recall"]


def load(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line] if path.exists() else []


def line_text(lines: list[dict]) -> str:
    return " ".join(ln["text"] for ln in lines)


def agg(scores: list[dict]) -> dict:
    out = {}
    for k in METRIC_KEYS:
        vals = [s[k] for s in scores if s.get(k) is not None]
        out[k] = round(mean(float(v) for v in vals), 4) if vals else None
    out["n"] = len(scores)
    return out


def word_correctness(pred_words: list[str], truth: str) -> list[bool]:
    """Which predicted words match the ground truth after alignment."""
    t = metrics.normalise(truth).split()
    p = [metrics.normalise(w) for w in pred_words]
    ok = [False] * len(p)
    for block in SequenceMatcher(a=p, b=t, autojunk=False).get_matching_blocks():
        for k in range(block.size):
            ok[block.a + k] = True
    return ok


def readings_for(rec: dict, names: list[str]) -> list[fusion.Reading]:
    out = []
    for name in names:
        v = rec["variants"].get(name)
        if v is not None:
            out.append(fusion.Reading(f"rapidocr:{name}", v["lines_orig"]))
    return out


def map_boxes_to_original(rec: dict, image_path: Path) -> None:
    """Raw runs store boxes in each variant's pixels. Variants are
    deterministic, so rebuild them (no OCR) to get each one's matrix and map
    its boxes back onto the original photo."""
    img = cv2.imread(str(image_path))
    q = rec["quality"]
    built = {v.name: v for v in preprocess.variants(img, q["median_line_height"], q["skew_deg"])}
    for name, v in rec["variants"].items():
        var = built.get(name)
        if var is None or list(var.image.shape[:2]) != v["shape"]:
            raise RuntimeError(f"variant {name} of {rec['image']} doesn't match the raw run")
        v["lines_orig"] = [{**ln, "box": var.to_original(ln["box"])} for ln in v["lines"]]


def flag_stats(recs, truth_by_image, names, low, high, min_support, gate="indian"):
    """gate: None (agreement + score only), "base" (lexicon without the
    curated Indian terms) or "indian" (full lexicon, as in production)."""
    plaus = None if gate is None else (lambda w: lexicon.plausible(w, include_indian=(gate == "indian")))
    tot = wrong = flagged = flagged_wrong = silent = 0
    by_status = defaultdict(lambda: [0, 0])  # status -> [count, correct]
    for rec in recs:
        words = fusion.fuse(readings_for(rec, names), anchor="rapidocr:original")
        fusion.assign_status(words, low, high, min_support, plausible=plaus)
        ok = word_correctness([w.text for w in words], truth_by_image[rec["image"]])
        for w, good in zip(words, ok):
            tot += 1
            by_status[w.status][0] += 1
            by_status[w.status][1] += good
            is_flag = w.status != fusion.CONFIRMED
            flagged += is_flag
            if not good:
                wrong += 1
                flagged_wrong += is_flag
                silent += not is_flag
    return {
        "words": tot,
        "wrong_words": wrong,
        "error_flag_recall": round(flagged_wrong / wrong, 4) if wrong else None,
        "flag_precision": round(flagged_wrong / flagged, 4) if flagged else None,
        "flag_rate": round(flagged / tot, 4) if tot else None,
        "silent_errors": silent,
        "silent_error_rate": round(silent / tot, 5) if tot else None,
        "status_accuracy": {s: {"count": c, "correct_share": round(k / c, 4)} for s, (c, k) in sorted(by_status.items())},
    }


def calibration(recs, truth_by_image, bins=(0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.98, 1.01)):
    counts = defaultdict(lambda: [0, 0])
    for rec in recs:
        lines = rec["variants"]["original"]["lines"]
        words, scores = [], []
        for ln in lines:
            for w in ln["text"].split():
                words.append(w)
                scores.append(ln["score"])
        for s, good in zip(scores, word_correctness(words, truth_by_image[rec["image"]])):
            for lo, hi in zip(bins, bins[1:]):
                if lo <= s < hi:
                    counts[(lo, hi)][0] += 1
                    counts[(lo, hi)][1] += good
    return [
        {"score_range": f"{lo:.2f}-{min(hi, 1.0):.2f}", "words": c, "share_correct": round(k / c, 4) if c else None}
        for (lo, hi), (c, k) in sorted(counts.items())
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="synthetic")
    args = ap.parse_args()
    base = ROOT / args.set
    manifest = {r["image"]: r for r in load(base / "manifest.jsonl")}
    recs = load(ROOT / "results" / "raw" / f"{args.set}_rapidocr.jsonl")
    tess = {r["image"]: r for r in load(ROOT / "results" / "raw" / f"{args.set}_tesseract.jsonl")}
    if not recs:
        raise SystemExit("no raw results; run eval.run_ocr first")

    label_ids = list(dict.fromkeys(manifest[r["image"]]["label_id"] for r in recs))
    train_ids = set(label_ids[: len(label_ids) // 2])
    truth = {img: m["text"] for img, m in manifest.items()}

    # ---- 1. per-variant accuracy, by category ----
    per = defaultdict(lambda: defaultdict(list))  # variant -> category -> scores
    oracle = defaultdict(list)
    tess_scores = defaultdict(list)
    seconds = defaultdict(list)
    quality_rows = []
    for rec in recs:
        m = manifest[rec["image"]]
        best = None
        for name, v in rec["variants"].items():
            s = metrics.score(line_text(v["lines"]), m["text"], m["allergens"])
            per[name][m["category"]].append(s)
            per[name]["ALL"].append(s)
            seconds[name].append(v["seconds"])
            if best is None or s["cer"] < best["cer"]:
                best = s
        oracle[m["category"]].append(best)
        oracle["ALL"].append(best)
        orig = metrics.score(line_text(rec["variants"]["original"]["lines"]), m["text"], m["allergens"])
        quality_rows.append({**rec["quality"], "category": m["category"], "cer": orig["cer"], "ing_recall": orig["ing_recall"]})
        if rec["image"] in tess:
            ts = metrics.score(tess[rec["image"]]["text"], m["text"], m["allergens"])
            tess_scores[m["category"]].append(ts)
            tess_scores["ALL"].append(ts)

    categories = sorted({manifest[r["image"]]["category"] for r in recs})
    variant_names = sorted(per, key=lambda v: (v != "original", v))
    table = {v: {c: agg(per[v][c]) for c in categories + ["ALL"]} for v in variant_names}

    # ---- 2. choose fusion set + thresholds on TRAIN, report on TEST ----
    for rec in recs:
        map_boxes_to_original(rec, base / rec["image"])
    train = [r for r in recs if manifest[r["image"]]["label_id"] in train_ids]
    test = [r for r in recs if manifest[r["image"]]["label_id"] not in train_ids]
    candidates = [v for v in ("clahe", "illum", "adaptive", "denoise_sharpen", "otsu", "upscale") if v in table]
    sets = [["original"]] + [["original", *c] for n in (1, 2, 3) for c in combinations(candidates, n)]
    grid = []
    for names in sets:
        for low in (0.5, 0.7, 0.8):
            for high in (0.9, 0.95, 0.98):
                st = flag_stats(train, truth, names, low, high, 1.0)
                grid.append((names, low, high, st))
    # Primary goal: fewest silent errors; then fewest flags (so the user isn't
    # asked to check everything).
    viable = [g for g in grid if g[3]["flag_rate"] is not None and g[3]["flag_rate"] <= 0.35]
    chosen = min(viable or grid, key=lambda g: (g[3]["silent_errors"], g[3]["flag_rate"]))
    names, low, high, train_stats = chosen
    test_stats = flag_stats(test, truth, names, low, high, 1.0)
    baseline_test = flag_stats(test, truth, ["original"], low, high, 1.0)
    no_gate_test = flag_stats(test, truth, names, low, high, 1.0, gate=None)
    base_gate_test = flag_stats(test, truth, names, low, high, 1.0, gate="base")

    calib = calibration(recs, truth)

    # ---- 3. quality vs accuracy ----
    by_verdict = defaultdict(list)
    for q in quality_rows:
        by_verdict[q["verdict"]].append(q)
    sharp_bins = [(0, 0.35), (0.35, 1), (1, 3), (3, 10), (10, 1e9)]
    by_sharp = []
    for lo, hi in sharp_bins:
        rows = [q for q in quality_rows if q["median_sharpness"] is not None and lo <= q["median_sharpness"] < hi]
        if rows:
            by_sharp.append({"sharpness": f"{lo}-{hi if hi < 1e9 else 'inf'}", "images": len(rows),
                             "mean_cer": round(mean(r["cer"] for r in rows), 4),
                             "mean_ing_recall": round(mean(r["ing_recall"] for r in rows), 4)})

    summary = {
        "set": args.set,
        "images": len(recs),
        "per_variant": table,
        "oracle_best_variant_upper_bound": {c: agg(oracle[c]) for c in categories + ["ALL"]},
        "tesseract_js_original": {c: agg(tess_scores[c]) for c in categories + ["ALL"]} if tess_scores else None,
        "seconds_median": {v: median(seconds[v]) for v in seconds},
        "tesseract_seconds_median": median(r["seconds"] for r in tess.values()) if tess else None,
        "fusion": {
            "chosen_on_train": {"variants": names, "low_score": low, "high_score": high, "train": train_stats},
            "test": test_stats,
            "test_original_only_same_thresholds": baseline_test,
            "test_without_lexicon_gate": no_gate_test,
            "test_lexicon_without_indian_terms": base_gate_test,
        },
        "score_calibration_original": calib,
        "quality_vs_accuracy": {
            "by_verdict": {v: {"images": len(rows), "mean_cer": round(mean(r["cer"] for r in rows), 4),
                               "mean_ing_recall": round(mean(r["ing_recall"] for r in rows), 4)} for v, rows in by_verdict.items()},
            "by_sharpness": by_sharp,
        },
    }
    out_dir = ROOT / "results"
    (out_dir / f"{args.set}_summary.json").write_text(json.dumps(summary, indent=1))
    (out_dir / f"{args.set}_report.md").write_text(render(summary, categories, variant_names))
    print((out_dir / f"{args.set}_report.md").read_text())


def fmt(x, pct=False):
    if x is None:
        return "–"
    return f"{x * 100:.1f}%" if pct else f"{x:.3f}"


def render(s, categories, variants) -> str:
    L = [f"# OCR evaluation: {s['set']} set ({s['images']} images)\n"]
    if s["set"] == "synthetic":
        L.append("> **Synthetic data.** Rendered labels with controlled degradations. Use these numbers to compare techniques, "
                 "not as real-world accuracy. Real-photo results are in `real_report.md` once real photos are added.\n")
    L.append("## 1. Character error rate (CER, lower is better) by condition and preprocessing variant\n")
    L.append("| condition | " + " | ".join(variants) + " | oracle* |" + (" tesseract.js |" if s["tesseract_js_original"] else ""))
    L.append("|---" * (len(variants) + 2 + (1 if s["tesseract_js_original"] else 0)) + "|")
    for c in categories + ["ALL"]:
        row = [fmt(s["per_variant"][v][c]["cer"]) if c in s["per_variant"][v] and s["per_variant"][v][c]["n"] else "–" for v in variants]
        row.append(fmt(s["oracle_best_variant_upper_bound"][c]["cer"]))
        if s["tesseract_js_original"]:
            row.append(fmt(s["tesseract_js_original"][c]["cer"]))
        L.append(f"| {'**ALL**' if c == 'ALL' else c} | " + " | ".join(row) + " |")
    L.append("\n\\*oracle = best variant picked per image *using the answer*. It's an upper bound for variant selection, not achievable as-is.\n")

    L.append("## 2. Ingredient recall (share of true ingredients read exactly) by condition\n")
    L.append("| condition | " + " | ".join(variants) + (" | tesseract.js |" if s["tesseract_js_original"] else " |"))
    L.append("|---" * (len(variants) + 1 + (1 if s["tesseract_js_original"] else 0)) + "|")
    for c in categories + ["ALL"]:
        row = [fmt(s["per_variant"][v][c]["ing_recall"], True) if s["per_variant"][v].get(c, {}).get("n") else "–" for v in variants]
        if s["tesseract_js_original"]:
            row.append(fmt(s["tesseract_js_original"][c]["ing_recall"], True))
        L.append(f"| {'**ALL**' if c == 'ALL' else c} | " + " | ".join(row) + " |")

    a = s["per_variant"]["original"]["ALL"]
    L.append("\n## 3. Headline numbers, RapidOCR on the original photo (all conditions)\n")
    L.append(f"- CER {fmt(a['cer'])}, WER {fmt(a['wer'])}")
    L.append(f"- Ingredient recall {fmt(a['ing_recall'], True)}, precision {fmt(a['ing_precision'], True)}, exact full list {fmt(a['exact_list'], True)}")
    L.append(f"- Allergen-term recall {fmt(a['allergen_recall'], True)}")
    if s["tesseract_js_original"]:
        t = s["tesseract_js_original"]["ALL"]
        L.append(f"- tesseract.js for comparison: CER {fmt(t['cer'])}, ingredient recall {fmt(t['ing_recall'], True)}, allergen-term recall {fmt(t['allergen_recall'], True)}")
    L.append(f"- Median time per read (RapidOCR, original): {s['seconds_median']['original']:.1f}s" +
             (f"; tesseract.js: {s['tesseract_seconds_median']:.1f}s" if s["tesseract_seconds_median"] else "") +
             " (the two runs shared the CPU, so absolute times are inflated)")

    f = s["fusion"]
    L.append("\n## 4. Does the pipeline know when it is wrong? (TEST labels only)\n")
    L.append(f"Fusion settings chosen on TRAIN labels: variants {f['chosen_on_train']['variants']}, "
             f"unreadable below score {f['chosen_on_train']['low_score']}, confirmed needs score ≥ {f['chosen_on_train']['high_score']} and full agreement.\n")
    L.append("| setting | words | wrong words | wrong words flagged | silent errors (wrong but 'confirmed') | words flagged for checking |")
    L.append("|---|---|---|---|---|---|")
    for name, st in (
        ("original only", f["test_original_only_same_thresholds"]),
        ("fused, agreement only (no lexicon check)", f["test_without_lexicon_gate"]),
        ("fused + lexicon without Indian terms", f["test_lexicon_without_indian_terms"]),
        ("fused + full lexicon (production)", f["test"]),
    ):
        L.append(f"| {name} | {st['words']} | {st['wrong_words']} | {fmt(st['error_flag_recall'], True)} | {st['silent_errors']} ({fmt(st['silent_error_rate'], True)} of words) | {fmt(st['flag_rate'], True)} |")
    L.append("\nShare of words actually correct, per status (TEST, fused):\n")
    L.append("| status | words | actually correct |")
    L.append("|---|---|---|")
    for k, v in f["test"]["status_accuracy"].items():
        L.append(f"| {k} | {v['count']} | {fmt(v['correct_share'], True)} |")

    L.append("\n## 5. Is the engine's score a probability? (calibration, original variant)\n")
    L.append("| raw score | words | actually correct |")
    L.append("|---|---|---|")
    for b in s["score_calibration_original"]:
        L.append(f"| {b['score_range']} | {b['words']} | {fmt(b['share_correct'], True)} |")

    q = s["quality_vs_accuracy"]
    L.append("\n## 6. Does the quality check predict accuracy?\n")
    L.append("| quality verdict | images | mean CER | mean ingredient recall |")
    L.append("|---|---|---|---|")
    for v, r in q["by_verdict"].items():
        L.append(f"| {v} | {r['images']} | {fmt(r['mean_cer'])} | {fmt(r['mean_ing_recall'], True)} |")
    L.append("\n| median line sharpness | images | mean CER | mean ingredient recall |")
    L.append("|---|---|---|---|")
    for r in q["by_sharpness"]:
        L.append(f"| {r['sharpness']} | {r['images']} | {fmt(r['mean_cer'])} | {fmt(r['mean_ing_recall'], True)} |")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    main()
