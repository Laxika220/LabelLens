# LabelLens

A mobile-first web app (PWA) that reads the ingredient label on packaged food, shows **how sure it is about every word**, and checks the confirmed list against your allergies and diet. It's an educational tool, not a medical device.

The priority is accuracy and honesty: the app should read whatever a photo genuinely allows, say plainly what it couldn't read, and never fill gaps with guesses.

## Architecture

```
Phone (Next.js PWA)                              Next.js server (Vercel)              Vision service (Python, container)
┌───────────────────────────────┐   photos    ┌──────────────────────────┐  token   ┌──────────────────────────────────────┐
│ camera / gallery, up to 4     │────────────▶│ /api/assess  /api/read   │─────────▶│ quality check per text line          │
│ crop + resize + JPEG          │             │ rate limit, validation   │          │ preprocessing variants (OpenCV)      │
│ (EXIF/GPS removed)            │◀────────────│ response schema check    │◀─────────│ RapidOCR on each variant             │
│                               │  statuses   └──────────────────────────┘          │ word-level fusion + lexicon check    │
│ review screen: confirmed /    │                                                   │ Claude vision as independent check   │
│ check / differ / unreadable / │                                                   │ photo merging, missing-text detection│
│ missing, show-on-photo        │                                                   └──────────────────────────────────────┘
│                               │
│ allergen + diet checks        │  ← run on the phone; the health profile never leaves the device
│ profiles in IndexedDB         │
└───────────────────────────────┘
Fallbacks: vision service down → Claude alone (everything marked "Check"); offline → Tesseract on the phone.
```

Why two services: OpenCV and the PaddleOCR models (via RapidOCR/ONNX) are mature, light and fast in Python, but too heavy to run in the browser or in a Vercel function. The Next.js app stays on Vercel; the vision service needs a small container (about 1 GB of RAM).

## How a label is read

1. **Quality check** of each photo, per text line: size, sharpness, contrast, glare, text cut off at an edge, skew, JPEG damage. Gives specific advice ("move closer", "tilt to remove glare", "capture the bottom section"). One blurry region doesn't reject the readable ones.
2. **Several readings**: OCR on the original photo and on selected processed versions. Which versions to use was chosen by measurement (see *Accuracy*), not by default.
3. **Word-by-word comparison**: every word records which readings agree and what the alternatives were.
4. **Status per word and per ingredient**:
   - *Confirmed*: all readings agree, high score, and the word is a known food word, English word, number or additive code.
   - *Check (probable)*: e.g. only one reader, or an unknown word. Look-alike fixes ("lodised" → "iodised") are offered, never applied.
   - *Readings differ (conflicting)*: the user picks.
   - *Unreadable*: the engine, or the AI check, couldn't read it.
   - *Missing*: text runs off the photo edge, the list has no start or end, or glare hides part of it.
5. **Claude vision (optional)** transcribes the photo independently, marking anything illegible instead of guessing. It can turn words into conflicts but never overrides the OCR on its own.
6. **Review**: the user confirms or fixes every line. Gaps must be acknowledged or retaken before continuing. If anything was unreadable, a prominent banner says allergens may be missed.

## Allergen and diet checks

These are deterministic (no AI) and run in the browser on the confirmed text (`lib/safety/`):

- FSSAI allergen groups plus the rest of the EU 14, with Indian names (maida, suji, besan, khoa, paneer, til, rai...).
- Levels: *contains*, *may contain* (precautionary statements), *source not stated* (lecithin, maltodextrin, unspecified vegetable oil, compounded hing), and *can't rule out* (when part of the label was unreadable). There is no "safe" level.
- Peanut and tree nut are separate. Look-alikes are excluded (coconut milk, cocoa butter, buckwheat, nutmeg).
- Diets: vegetarian (Indian sense, so no egg), vegan, Jain, halal, kosher.

## Information sources (in progress)

- `lib/kb/additives.json`: 729 INS/E codes from the Open Food Facts taxonomy (ODbL). Its 203 EFSA opinion links were each **verified against Crossref** (the DOI exists and its title matches).
- `lib/kb/regulatory-updates.json`: newer decisions (e.g. EFSA 2021 on titanium dioxide, WHO 2023 on aspartame), each **confirmed against the authority's own page** by `scripts/verify-regulatory.mjs`.
- `lib/evidence/pubmed.ts`: PubMed retrieval that prefers meta-analyses, systematic reviews and RCTs, and labels each study as human, animal or in vitro.
- Not yet built: AI-written summaries grounded only in retrieved sources, FSSAI status per additive, and the evidence UI.

## Accuracy

See `vision-service/eval/`. The synthetic benchmark (360 rendered labels, 15 degradation types) is used to *compare techniques*. **No real-world accuracy figure exists yet**: that needs real phone photos with hand-checked transcriptions (`vision-service/eval/real/README.md`).

## Run locally

```bash
# 1. Vision service (Python 3.13)
cd vision-service
python3.13 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
VISION_SERVICE_TOKEN=dev-token .venv/bin/uvicorn app.main:app --port 8001

# 2. Web app (another terminal)
cd ..
npm install
cp .env.example .env.local   # set VISION_SERVICE_URL=http://127.0.0.1:8001 and VISION_SERVICE_TOKEN=dev-token
npm run dev
```

The live camera needs HTTPS on a phone: `npx next dev --experimental-https`, then open `https://<computer-ip>:3000`.

| Command | What it runs |
| --- | --- |
| `npm test` | Web unit tests (parser, allergen matcher, diets, PubMed parsing) |
| `LIVE=1 npm test` | Tests that call real external APIs (PubMed) |
| `npm run e2e` | Playwright at 360 px: starts both services, uploads real images through the full pipeline |
| `cd vision-service && .venv/bin/python -m pytest` | Vision service tests |
| `.venv/bin/python -m eval.synth && .venv/bin/python -m eval.run_ocr && .venv/bin/python -m eval.analyse` | Rebuild and score the synthetic benchmark (about 75 minutes on an M1) |

## Environment variables

| Name | Where | Purpose |
| --- | --- | --- |
| `VISION_SERVICE_URL`, `VISION_SERVICE_TOKEN` | web | Reach the vision service; the token never reaches the browser |
| `VISION_SERVICE_TOKEN` | vision service | Must match the web app's token |
| `ANTHROPIC_API_KEY` | vision service (and web, for the fallback) | Claude vision cross-check. Optional: without it, OCR readings are cross-checked only against each other |
| `CLAUDE_MODEL` | both | Default `claude-sonnet-5-5` |
| `NCBI_API_KEY` | web | Optional: raises the PubMed rate limit |

## Privacy

Photos are cropped and re-encoded on the phone (removing EXIF/GPS), processed in memory by the server and not stored or logged. Profiles and scans live only in the browser (IndexedDB), with a "Delete all my data" button on the profile page. API keys stay on the servers.

## Licences of data

Open Food Facts taxonomies: ODbL, © Open Food Facts contributors. English word list: Webster's Second International (public domain).
