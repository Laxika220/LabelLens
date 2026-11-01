import type { ExtractedIngredient, ExtractedSubIngredient, Extraction } from "@/lib/ai/schemas";

// Turns raw ingredient-list text (from on-device OCR or typed by the user)
// into the same shape Claude returns, so the confirmation screen has one input.

const ALLERGEN_STATEMENT = /\b(contains|may contain|may also contain|traces? of|made in a (?:facility|factory)|produced in a|processed in a|allergy advice)\b[^.]*\.?/gi;
const CODE = /\b(E|INS)\s?-?(\d{3,4}[a-z]?(?:\([ivx]+\))?)\b/gi;
const PERCENT = /(\d+(?:[.,]\d+)?)\s*%/;
const INS_NUM = String.raw`\d{3,4}[a-z]?(?:\([ivx]+\))?`;
const BARE_CODES = new RegExp(String.raw`^\s*${INS_NUM}(?:\s*(?:,|&|and)\s*${INS_NUM})*\s*$`, "i");

// Split on commas/semicolons that are not inside brackets.
export function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim().replace(/[.\s]+$/, "")).filter(Boolean);
}

function codesIn(text: string): string[] {
  const codes: string[] = [];
  for (const m of text.matchAll(CODE)) {
    const n = m[2].toUpperCase();
    codes.push(`INS ${n}`, `E${n}`);
  }
  return codes;
}

// Very rough read-quality signal for OCR text: odd characters or fragments
// that are too short/long to be an ingredient get a lower score.
function ocrConfidence(raw: string): number {
  const letters = raw.replace(/[^a-z]/gi, "").length;
  const odd = raw.replace(/[a-z0-9\s,.%()\-&'/:]/gi, "").length;
  if (letters < 2 || raw.length > 80) return 0.35;
  if (odd > 0) return 0.5;
  return 0.7;
}

// Remove bracketed text, including nested brackets like "(503(ii), 500(ii))".
function stripBrackets(text: string): string {
  let depth = 0;
  let out = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

function canonicalOf(raw: string): string {
  return stripBrackets(raw)
    .replace(CODE, " ")
    .replace(PERCENT, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseItem(raw: string, confidence: (s: string) => number): ExtractedIngredient {
  const percentMatch = raw.match(PERCENT);
  const codes = codesIn(raw);
  const sub_ingredients: ExtractedSubIngredient[] = [];

  // Content of the first top-level bracket group becomes sub-ingredients,
  // unless it is just INS numbers like "Emulsifier (322, 471)" or a single
  // alternate name like "Refined wheat flour (maida)".
  const open = raw.indexOf("(");
  const close = raw.lastIndexOf(")");
  if (open > -1 && close > open) {
    const inner = raw.slice(open + 1, close);
    if (BARE_CODES.test(inner)) {
      for (const n of inner.match(new RegExp(INS_NUM, "gi")) ?? []) codes.push(`INS ${n.toUpperCase()}`, `E${n.toUpperCase()}`);
    } else if (/[,;]/.test(inner)) {
      for (const part of splitTopLevel(inner)) {
        const p = part.match(PERCENT);
        sub_ingredients.push({
          raw: part,
          canonical: canonicalOf(part),
          codes: codesIn(part),
          percent: p ? parseFloat(p[1].replace(",", ".")) : null,
          confidence: confidence(part),
        });
      }
    }
  }

  return {
    raw,
    canonical: canonicalOf(raw) || raw.toLowerCase(),
    codes: [...new Set(codes)],
    percent: percentMatch ? parseFloat(percentMatch[1].replace(",", ".")) : null,
    confidence: confidence(raw),
    sub_ingredients,
  };
}

// Re-derive codes/percent/sub-ingredients after the user edits one item.
export function parseIngredient(raw: string): ExtractedIngredient {
  return parseItem(raw.trim(), () => 1);
}

export function parseLabelText(
  text: string,
  opts: { fromOcr?: boolean } = {},
): Extraction {
  const confidence = opts.fromOcr ? ocrConfidence : () => 1;
  let body = text.replace(/\s+/g, " ").replace(/-\s(?=[a-z])/g, "");

  const allergen_statements = [...body.matchAll(ALLERGEN_STATEMENT)].map((m) => m[0].trim());
  for (const s of allergen_statements) body = body.replace(s, " ");

  const start = body.search(/ingredients?\s*[:\-]/i);
  if (start > -1) body = body.slice(start).replace(/^ingredients?\s*[:\-]\s*/i, "");

  const ingredients = splitTopLevel(body)
    .filter((s) => s.length < 200)
    .map((s) => parseItem(s, confidence));

  return {
    product_name_guess: null,
    language: "en",
    ingredients,
    allergen_statements,
    unreadable_regions: false,
    notes: opts.fromOcr
      ? "Read on your device without AI, so spelling mistakes are likely. Please check each item against the label."
      : "",
  };
}
