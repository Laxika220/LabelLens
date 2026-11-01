# LabelLens audit (milestone 1)

Date: 2026-11-01. Scope: everything under `Downloads/files-5/`.

## What exists

| Part | Location | What it does |
| --- | --- | --- |
| Flask prototype | `files-5/app.py`, `app.js`, `index.html` (a duplicate copy is in `files-5/labellens/`) | Server OCR with RapidOCR + CLAHE, then regex keyword matching against 19 hand-written ingredient entries with "Low concern / Limit / Avoid" grades and links. |
| Next.js PWA | `files-5/labellens-web/` | Camera capture → client preprocessing → one Claude vision call (or on-device Tesseract.js) → editable confirmation screen. No analysis yet. |

There is no LabelLens git repository. The only repo on this machine is the home folder (`/Users/laxikabisht`), whose remote `Laxika220/trailmate` does not exist on GitHub. LabelLens files were untracked.

Hardware for local work: Apple M1, 8 GB RAM, about 13 GB of free disk. RapidOCR (PP-OCRv6 small, ONNX) measured here: about 3 s for the first image, peak memory about 630 MB. That is acceptable. Bigger models (full PaddleOCR, local super-resolution networks, local LLMs) are not.

## Weakest parts of the image-reading pipeline (ranked)

1. **One AI call decides everything, and nothing checks it.** `/api/extract` asks Claude to read the photo, and the result is accepted as-is. A language model reading a blurry word tends to output the *most plausible* ingredient ("emulsif…" becomes "emulsifier"), which is exactly the hallucination we must avoid. Nothing compares it against an independent reading.
2. **The confidence numbers aren't measured.** Claude's `confidence` is self-reported and uncalibrated. The Tesseract fallback uses the hard-coded values 0.7 / 0.5 / 0.35 from a character heuristic. The "low confidence" highlight on the confirm screen therefore has no measured meaning.
3. **There's no provenance.** Ingredients have no bounding box, engine name or agreement flag, so the user can't see *where* in the photo an item came from, and we can't show unreadable regions.
4. **Content outside the guide frame is lost without warning.** The camera crops to the guide frame. If the list extends beyond it, the missing text never reaches OCR, and nothing reports "bottom of the list not captured".
5. **Preprocessing is applied blindly.** Every photo gets a contrast stretch and sharpening, and only the processed version is kept. That was never measured and can hurt OCR (sharpening amplifies JPEG noise). The original is discarded.
6. **Downscaling can destroy small text.** The longest edge is capped at 1600 px. On a dense label, small text can drop below the roughly 12 px x-height that OCR needs.
7. **Quality checks are shallow.** There's one global blur number (Laplacian at 240 px) and one glare number, with guessed thresholds. There are no checks for resolution or text height, exposure or shadows, perspective, or per-region quality, and no specific advice ("move closer").
8. **There's no geometry correction.** No perspective or rotation correction is done apart from EXIF orientation. Curved and tilted packs go straight to OCR.
9. **Multi-photo merging is naive.** Claude path: the model merges overlaps (it can drop or duplicate). Tesseract path: texts are joined with a comma, which duplicates overlapping text.
10. **"Unreadable" and "missing" aren't distinguished.** There's only an `unreadable_regions` boolean, with no per-item statuses (confirmed / probable / unreadable / conflicting / missing).
11. **Nothing has been measured.** There's no dataset, no CER/WER, and no ingredient recall. Every accuracy statement so far would be a guess.

## Biggest threats to the reliability of the food information

1. **The prototype's claims are hand-written from model memory.** The 19 entries in `app.js` were written without retrieval. Some cite real pages, but none were verified against the claim they support.
2. **The prototype uses "good/bad" grades.** The labels "Avoid if you can" and "Limit" are verdicts, not evidence. They mix regulatory status, dose and association/causation into one word.
3. **Keyword matching makes wrong inferences.** For example, `lecithin` maps to *soy* (lecithin is often sunflower-derived), `shortening` maps to trans fat, and `e322` becomes a soy flag. These are false positives, and the reverse failure mode is worse: an unlisted allergen synonym (e.g. *paneer*, *khoya*, *besan* for chickpea, *atta*) is silently treated as fine.
4. **An absence of matches reads as safe.** Both apps only say what they found. Neither says "an allergen section was unreadable, so this result cannot rule out allergens".
5. **The prototype has no regulatory jurisdiction or dates.** EFSA's titanium-dioxide decision is shown without saying it is EU-specific or what FSSAI says.
6. **The Next.js app has no information layer yet.** That's good: there's nothing unreliable to remove, and the evidence layer can be built correctly from the start.

## Decisions

- **Two services.** The Next.js app handles UI, PWA, Claude calls and evidence. It deploys to Vercel. A Python **vision-service** (FastAPI + OpenCV + RapidOCR) handles quality assessment, preprocessing and OCR, because OpenCV and PaddleOCR models are mature in Python and too heavy for the phone. It deploys to a container host with at least 1 GB of RAM.
- **OCR engines to compare:** RapidOCR (PP-OCRv6, on the server, gives line boxes), Tesseract (the browser fallback; tesseract.js is used for evaluation too), and Claude vision (the strongest reader, but generative, so it's treated as an *independent transcriber*, never as the judge). PaddleOCR proper is not added: RapidOCR runs the same models with a fraction of the dependencies.
- **Verification rule:** an ingredient is *confirmed* only if two independent readings agree (or one reading is high-confidence and passes a knowledge-base check). When they disagree, it's *conflicting*: both readings are shown and the user picks. Claude is not allowed to settle conflicts.
- **Keep originals.** Every processed variant is derived from the untouched original. Which variants run is decided by measurement (milestone 3/5), not by default.
- **No generative super-resolution.** Upscaling uses classical interpolation only (bicubic/Lanczos), which cannot invent characters.
- **Evaluation honesty:** the synthetic degraded-label set is used to *compare techniques*. Real-world accuracy figures will only be reported from real photographs with hand-checked ground truth, which the owner must photograph (see `eval/README.md`, created in milestone 5).
