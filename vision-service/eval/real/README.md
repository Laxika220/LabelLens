# Real-photo test set

Synthetic images can compare techniques, but they can't tell us how well LabelLens reads *real* packs. Only this folder can. Until it holds real photos with checked ground truth, **no real-world accuracy figure may be claimed**.

## What to collect (target: 60+ labels, at least 30 to start)

Photograph real packs with your phone, the way a user would. Cover:

| Condition | Examples | Aim for |
| --- | --- | --- |
| clear | flat box, good light | 10 |
| low resolution / far away | whole pack in frame | 5 |
| blurry | slightly out of focus, moving hand | 5 |
| glare | glossy wrapper under a ceiling light | 8 |
| curved | bottles, jars, cans | 8 |
| rotated / tilted | phone held at an angle | 5 |
| small or dense text | spice mixes, noodles | 8 |
| faded / low contrast | old packs, gold or silver text | 4 |
| busy backgrounds | printed patterns behind text | 4 |
| multilingual | Hindi + English, regional languages | 8 |
| multi-photo | list wrapping around the pack | 6 |

Spread these across product types (biscuits, namkeen, noodles, chocolate, beverages, dairy, sauces, spices, bakery, frozen foods) and across brands.

## Ground truth: the rules

1. Type the ingredients list and allergen statements **from the physical pack in your hand**, not from the photo, so the truth includes text the photo may have lost.
2. Copy exactly: spelling, capitals, brackets, percentages, INS numbers, punctuation.
3. Have a second person check each transcription against the pack. Note who checked it.
4. Hindi/regional text: type it in its own script (Unicode), not transliterated.

Save photos in `images/` (git-ignored, so your photos are never pushed) and add one line per label to `labels.jsonl`, following `labels.example.jsonl`:

- `images`: one or more photos of the same label, in reading order
- `allergens`: allergen-bearing terms exactly as printed (used for allergen recall)
- `conditions`: tags from the table above
- `language`: `en`, `hi`, `en+hi`, ...

## Run

```bash
.venv/bin/python -m eval.run_real          # reads labels.jsonl, writes results/real_report.md
```

With `ANTHROPIC_API_KEY` set, the AI cross-check is included; the report shows both.

## Open Food Facts records (less typing, but still checked by hand)

`build_from_off.py` fetches Indian products from [Open Food Facts](https://world.openfoodfacts.org) (OFF): real photos that volunteers took of real packs, plus the ingredient text they typed. It saves the photo exactly as uploaded to `images/` and adds lines to `labels.jsonl` in the same schema as above.

```bash
.venv/bin/python -m eval.real.build_from_off survey               # what's available, no downloads
.venv/bin/python -m eval.real.build_from_off build --transforms   # download + write labels.jsonl
```

What it guarantees:

- **Exact variant:** the photo and the text come from the same barcode and the same language. Nothing is copied between variants (Maggi Masala and Maggi Atta have different barcodes and different records).
- **Nothing invented:** a product with no ingredient text gets no record. Allergen terms are fragments copied from the text. Gaps are listed, never filled.
- **Indian packs only:** barcodes must start with 890 (GS1 India), and text must be English or Hindi.
- **Your own lines are safe:** rebuilding replaces only lines tagged `off_unverified`. Hand-made lines, and OFF lines you have verified, are kept.
- **Transformed copies** (`--transforms`) are separate lines with ids ending `__t_blur`, `__t_glare`, `__t_rotation` or `__t_lowres`, tagged `transformed`, so they're never mistaken for real conditions.

**Why every OFF record is `off_unverified`:** OFF text was typed (or machine-read) *from a photo* by volunteers, not checked against the pack. Common problems, all flagged in each record's `notes`:

- OCR errors such as "lodised" for "Iodised".
- Nutrition or address text mixed in.
- Lists cut short.
- Text edited for a newer pack than the photo.

It also usually leaves out the "Ingredients:" heading, which slightly raises CER (the character error rate) but doesn't affect ingredient scores.

To verify a record:

1. Open the photo next to the text, ideally with the pack in hand.
2. Correct the `text` and `allergens` to match the printed label.
3. Fill `conditions` (glare, curved, ...) from the photo.
4. **Remove `off_unverified`** and add who checked it to `notes`.

`run_real` reports unverified OFF records, hand-checked records and transformed copies in separate rows, and never averages them together.

Licences: OFF data is ODbL 1.0 and the photos are CC BY-SA 3.0, © Open Food Facts contributors. Each record's `notes`, and `off_manifest.json`, keep the product URL, the photo URL, the contributor and the retrieval date. Photos stay in the git-ignored `images/` folder, so they aren't redistributed. If you publish `labels.jsonl`, keep the attribution, and release it under ODbL. The script identifies itself to OFF (set `OFF_CONTACT` to add your contact) and stays under OFF's limits of 10 searches/min and 100 reads/min, caching every response in `.off_cache/`.
