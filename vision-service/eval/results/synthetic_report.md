# OCR evaluation: synthetic set (360 images)

> **Synthetic data.** Rendered labels with controlled degradations. Use these numbers to compare techniques, not as real-world accuracy. Real-photo results are in `real_report.md` once real photos are added.

## 1. Character error rate (CER, lower is better) by condition and preprocessing variant

| condition | original | adaptive | clahe | denoise_sharpen | geometry | illum | otsu | upscale | oracle* | tesseract.js |
|---|---|---|---|---|---|---|---|---|---|---|
| blur | 0.009 | 0.075 | 0.024 | 0.017 | 0.009 | 0.025 | 0.167 | – | 0.006 | 0.043 |
| clean | 0.003 | 0.002 | 0.012 | 0.010 | 0.010 | 0.002 | 0.002 | – | 0.002 | 0.002 |
| combo | 0.004 | 0.009 | 0.007 | 0.009 | 0.012 | 0.033 | 0.361 | – | 0.002 | 0.045 |
| curved | 0.003 | 0.009 | 0.007 | 0.002 | 0.003 | 0.003 | 0.002 | – | 0.001 | 0.013 |
| dense | 0.029 | 0.016 | 0.029 | 0.042 | 0.022 | 0.032 | 0.040 | 0.041 | 0.003 | 0.003 |
| faded | 0.004 | 0.015 | 0.005 | 0.011 | 0.012 | 0.013 | 0.009 | – | 0.001 | 0.002 |
| glare | 0.091 | 0.093 | 0.091 | 0.112 | 0.099 | 0.099 | 0.205 | – | 0.086 | 0.118 |
| jpeg | 0.011 | 0.010 | 0.004 | 0.003 | 0.004 | 0.004 | 0.023 | 0.004 | 0.002 | 0.010 |
| low_res | 0.003 | 0.031 | 0.004 | 0.005 | 0.003 | 0.005 | 0.025 | 0.005 | 0.002 | 0.013 |
| motion_blur | 0.141 | 0.437 | 0.134 | 0.238 | 0.166 | 0.149 | 0.650 | – | 0.120 | 0.361 |
| pattern | 0.021 | 0.036 | 0.002 | 0.009 | 0.009 | 0.017 | 0.049 | – | 0.001 | 0.045 |
| perspective | 0.002 | 0.016 | 0.008 | 0.002 | 0.009 | 0.003 | 0.002 | – | 0.002 | 0.003 |
| rotated | 0.024 | 0.009 | 0.016 | 0.017 | 0.018 | 0.019 | 0.022 | – | 0.003 | 0.245 |
| shadow | 0.008 | 0.008 | 0.003 | 0.002 | 0.002 | 0.009 | 0.176 | – | 0.001 | 0.030 |
| small_font | 0.002 | 0.003 | 0.009 | 0.009 | 0.002 | 0.004 | 0.009 | 0.010 | 0.001 | 0.006 |
| **ALL** | 0.024 | 0.051 | 0.024 | 0.032 | 0.022 | 0.028 | 0.116 | 0.007 | 0.016 | 0.063 |

\*oracle = best variant picked per image *using the answer*. It's an upper bound for variant selection, not achievable as-is.

## 2. Ingredient recall (share of true ingredients read exactly) by condition

| condition | original | adaptive | clahe | denoise_sharpen | geometry | illum | otsu | upscale | tesseract.js |
|---|---|---|---|---|---|---|---|---|---|
| blur | 83.8% | 22.8% | 76.4% | 83.4% | 84.3% | 74.3% | 8.2% | – | 82.5% |
| clean | 92.7% | 95.2% | 94.0% | 95.5% | 95.2% | 96.1% | 94.9% | – | 93.8% |
| combo | 94.0% | 65.8% | 90.4% | 91.6% | 92.1% | 80.1% | 12.2% | – | 61.7% |
| curved | 93.1% | 93.3% | 90.6% | 93.5% | 93.0% | 92.6% | 95.3% | – | 96.5% |
| dense | 88.5% | 85.8% | 86.9% | 76.9% | 84.7% | 84.7% | 63.7% | 77.8% | 91.6% |
| faded | 94.6% | 90.8% | 91.7% | 94.5% | 94.1% | 93.6% | 94.8% | – | 93.7% |
| glare | 62.0% | 60.6% | 61.7% | 63.8% | 65.4% | 65.7% | 47.0% | – | 56.9% |
| jpeg | 88.0% | 75.8% | 87.1% | 90.7% | 85.7% | 88.4% | 54.0% | 88.9% | 86.6% |
| low_res | 90.6% | 70.5% | 89.6% | 88.8% | 90.6% | 91.8% | 49.3% | 91.8% | 72.5% |
| motion_blur | 14.8% | 2.6% | 16.4% | 5.2% | 8.2% | 13.4% | 0.0% | – | 2.6% |
| pattern | 88.6% | 85.0% | 95.6% | 95.4% | 93.0% | 92.9% | 86.6% | – | 86.4% |
| perspective | 95.6% | 94.0% | 93.8% | 96.1% | 95.2% | 94.8% | 95.0% | – | 93.9% |
| rotated | 93.7% | 95.2% | 91.8% | 94.3% | 94.9% | 92.3% | 91.5% | – | 10.5% |
| shadow | 96.6% | 94.4% | 94.5% | 97.1% | 93.9% | 94.0% | 38.4% | – | 80.2% |
| small_font | 94.2% | 91.8% | 95.8% | 95.5% | 91.4% | 94.5% | 94.2% | 95.4% | 86.6% |
| **ALL** | 84.7% | 74.9% | 83.8% | 84.2% | 85.8% | 83.3% | 61.7% | 91.5% | 73.1% |

## 3. Headline numbers, RapidOCR on the original photo (all conditions)

- CER 0.024, WER 0.090
- Ingredient recall 84.7%, precision 86.2%, exact full list 45.6%
- Allergen-term recall 92.6%
- Claude vision: **not measured** (no API key was available for this run; `python -m eval.run_claude` adds it)
- tesseract.js for comparison: CER 0.063, ingredient recall 73.1%, allergen-term recall 85.2%
- Median time per read (RapidOCR, original): 1.3s; tesseract.js: 0.8s (the two runs shared the CPU, so absolute times are inflated)

## 4. Does the pipeline know when it is wrong? (TEST labels only)

Fusion settings chosen on TRAIN labels: variants ['original', 'adaptive', 'denoise_sharpen'], unreadable below score 0.5, confirmed needs score ≥ 0.98 and full agreement.

| setting | words | wrong words | wrong words flagged | silent errors (wrong but 'confirmed') | words flagged for checking |
|---|---|---|---|---|---|
| original only | 4985 | 348 | 100.0% | 0 (0.0% of words) | 100.0% |
| fused, agreement only (no lexicon check) | 4985 | 348 | 80.5% | 68 (1.4% of words) | 23.8% |
| fused + lexicon without Indian terms | 4985 | 348 | 95.7% | 15 (0.3% of words) | 26.5% |
| fused + full lexicon (production) | 4985 | 348 | 95.7% | 15 (0.3% of words) | 25.5% |

By condition (TEST, production settings):

| condition | words | wrong | wrong flagged | silent errors | flagged for checking | correct words flagged |
|---|---|---|---|---|---|---|
| blur | 318 | 28 | 92.9% | 2 | 62.6% | 59.7% |
| clean | 341 | 9 | 88.9% | 1 | 19.1% | 17.2% |
| combo | 337 | 11 | 90.9% | 1 | 26.1% | 23.9% |
| curved | 340 | 6 | 83.3% | 1 | 11.2% | 9.9% |
| dense | 337 | 14 | 92.9% | 1 | 16.0% | 12.7% |
| faded | 335 | 11 | 90.9% | 1 | 17.9% | 15.4% |
| glare | 316 | 38 | 94.7% | 2 | 32.3% | 23.7% |
| jpeg | 340 | 13 | 84.6% | 2 | 20.9% | 18.4% |
| low_res | 342 | 8 | 87.5% | 1 | 13.2% | 11.4% |
| motion_blur | 281 | 173 | 99.4% | 1 | 99.6% | 100.0% |
| pattern | 335 | 9 | 100.0% | 0 | 13.7% | 11.3% |
| perspective | 341 | 7 | 100.0% | 0 | 12.6% | 10.8% |
| rotated | 338 | 9 | 100.0% | 0 | 37.3% | 35.6% |
| shadow | 342 | 4 | 100.0% | 0 | 8.5% | 7.4% |
| small_font | 342 | 8 | 75.0% | 2 | 7.6% | 6.0% |

Share of words actually correct, per status (TEST, fused):

| status | words | actually correct |
|---|---|---|
| confirmed | 3713 | 99.6% |
| conflicting | 680 | 61.5% |
| probable | 592 | 88.0% |

## 5. Is the engine's score a probability? (calibration, original variant)

| raw score | words | actually correct |
|---|---|---|
| 0.50-0.70 | 40 | 0.0% |
| 0.70-0.80 | 22 | 9.1% |
| 0.80-0.90 | 292 | 29.8% |
| 0.90-0.95 | 234 | 43.6% |
| 0.95-0.98 | 1269 | 91.7% |
| 0.98-1.00 | 9307 | 97.5% |

## 6. Does the quality check predict accuracy?

| quality verdict | images | mean CER | mean ingredient recall |
|---|---|---|---|
| good | 275 | 0.010 | 91.6% |
| retake | 24 | 0.141 | 14.8% |
| usable | 61 | 0.038 | 81.1% |

| median line sharpness | images | mean CER | mean ingredient recall |
|---|---|---|---|
| 0.35-1 | 24 | 0.009 | 83.8% |
| 1-3 | 24 | 0.004 | 94.0% |
| 3-10 | 37 | 0.099 | 44.7% |
| 10-inf | 275 | 0.017 | 89.4% |
