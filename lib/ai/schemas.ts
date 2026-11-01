import * as z from "zod";

// Schema sent to Claude as the structured-output format. Kept free of numeric
// bounds so it stays within what structured outputs accept; values are
// clamped in normaliseExtraction() instead.
const SubIngredient = z.object({
  raw: z.string().describe("Exactly as printed, including codes/percent"),
  canonical: z.string().describe("Lower-case common name, e.g. 'lecithin'"),
  codes: z.array(z.string()).describe("E-/INS-numbers, e.g. ['INS 322','E322']"),
  percent: z.number().nullable(),
  confidence: z.number().describe("0-1: how sure you are this was read correctly"),
});

const Ingredient = SubIngredient.extend({
  sub_ingredients: z.array(SubIngredient),
});

export const ExtractionSchema = z.object({
  product_name_guess: z.string().nullable(),
  language: z.string().describe("ISO 639-1 code of the label text"),
  ingredients: z.array(Ingredient),
  allergen_statements: z.array(z.string()),
  unreadable_regions: z.boolean(),
  notes: z.string(),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedIngredient = z.infer<typeof Ingredient>;
export type ExtractedSubIngredient = z.infer<typeof SubIngredient>;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const pct = (n: number | null) =>
  n != null && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;

export function normaliseExtraction(e: Extraction): Extraction {
  const fixSub = (s: ExtractedSubIngredient): ExtractedSubIngredient => ({
    ...s,
    raw: s.raw.trim(),
    canonical: s.canonical.trim().toLowerCase(),
    codes: [...new Set(s.codes.map((c) => c.trim().toUpperCase()).filter(Boolean))],
    percent: pct(s.percent),
    confidence: clamp01(s.confidence),
  });
  return {
    ...e,
    ingredients: e.ingredients
      .filter((i) => i.raw.trim())
      .map((i) => ({ ...fixSub(i), sub_ingredients: i.sub_ingredients.map(fixSub) })),
    allergen_statements: e.allergen_statements.map((s) => s.trim()).filter(Boolean),
  };
}

// Request body for /api/extract.
export const ExtractRequestSchema = z.object({
  images: z
    .array(
      z.object({
        media_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
        // ~4.5 MB of base64 per image; preprocessed photos are far smaller.
        data: z.string().min(100).max(6_000_000),
      }),
    )
    .min(1)
    .max(4),
});
