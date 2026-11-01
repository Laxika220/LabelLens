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
