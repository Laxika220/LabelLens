# LabelLens (web)

Mobile-first PWA that reads food ingredient labels and (in later milestones) gives personalised, research-backed insights. Educational tool, not a medical device.

**Status: milestone 1 of 5: capture, extraction and confirmation.**

## Run it

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

The live camera needs HTTPS (or `localhost`). To test on a phone on the same Wi-Fi, run `npx next dev --experimental-https` and open `https://<your-computer-ip>:3000`. Without HTTPS the app still offers "Take photo" / "From gallery", which open the phone's camera app.

| Script | What it does |
| --- | --- |
| `npm test` | Unit tests (Vitest) |
| `npm run e2e` | Playwright flow at 360px width with a fake camera; builds and starts the app on port 3100 |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |

## Environment variables

| Name | Needed | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | For AI reading | Claude vision extraction. If unset, `/api/extract` returns 503 and the app reads the label on the device with Tesseract. |
| `CLAUDE_MODEL` | No | Defaults to `claude-sonnet-5-5`. |
| `NCBI_API_KEY`, `DATABASE_URL`, Upstash, `FDC_API_KEY` | Milestone 3+ | Evidence retrieval and the knowledge base. |

## How milestone 1 works

```
 phone                                             server (Next.js route handler)
 ┌──────────────────────────────────────────┐
 │ /scan  CameraCapture                     │
 │  getUserMedia(rear) + guide frame        │
 │  live blur (Laplacian var) / glare check │
 │  crop to frame → ≤1600px → contrast +    │
 │  sharpen → JPEG 0.85 (EXIF/GPS dropped)  │
 │  up to 4 photos per label                │
 └──────────────┬───────────────────────────┘
                │ online                      ┌───────────────────────────────┐
                ├────────────────────────────▶│ POST /api/extract             │
                │                             │  rate limit, zod-validate     │
                │                             │  Claude vision, structured    │
                │                             │  output (ExtractionSchema)    │
                │◀────────────────────────────│  image never stored or logged │
                │ offline / 503 / network err └───────────────────────────────┘
                ├──▶ Tesseract.js on device → parseLabelText()
                ▼
 IndexedDB draft (photos + extraction, local only)
                ▼
 /confirm  editable chips, low-confidence (<0.75) highlighted, nested
           sub-ingredients, allergen statements, product name, photo zoom
```

Key files:

- `lib/ai/prompts/extract.v1.ts`: versioned extraction prompt
- `lib/ai/schemas.ts`: Zod schema for extraction output plus clamping/normalisation
- `app/api/extract/route.ts`: Claude call (`messages.parse` + `zodOutputFormat`, effort `low` for speed)
- `lib/image/preprocess.ts`: crop, resize, enhance, quality metrics, EXIF stripping
- `lib/normalise/parse-label-text.ts`: text-to-ingredients parser (nested brackets, E/INS codes, percentages, "Contains/May contain")
- `lib/storage/indexeddb.ts`: local-first draft storage
- `public/sw.js`: offline app shell; caches Tesseract worker and language data after first use

## Known limitations (milestone 1)

- Blur and glare thresholds (`BLUR_THRESHOLD`, `GLARE_FRACTION`) are first guesses and need tuning on real phones.
- Tap-to-focus and torch only work where the browser exposes those camera controls (mostly Chrome on Android). iOS Safari ignores them.
- The rate limiter is in memory (one instance). Switch to Upstash before running more than one instance.
- On-device OCR is English only and less accurate than AI reading. The confirm screen says so.
- Barcode cross-check (Open Food Facts), the i18n scaffolding and the 30-photo golden set are not built yet.

## Roadmap

1. ✅ Capture, extraction, confirmation
2. Health profile (multi-profile, IndexedDB) and a deterministic allergen/diet safety layer
3. Evidence retrieval (PubMed, EFSA/FDA/FSSAI/JECFA, OFF, FDC) and grounded, cited analysis
4. Results UI, ingredient sheets, evidence badges, explore and chat
5. History, compare, learning, i18n, polish
