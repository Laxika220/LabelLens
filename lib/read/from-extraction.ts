import type { Extraction } from "@/lib/ai/schemas";
import type { Item, ReadResult } from "./types";

// Fallback readers (Claude alone, on-device Tesseract, or typed text) have
// no second reading to compare against, so nothing they produce can be
// "confirmed". Every item becomes "probable" and must be checked.

const STATEMENT = /^(contains?|may contain|allergy advice|made in a|prepared in a|traces of)\b/i;

export function fromExtraction(e: Extraction, source: "claude" | "tesseract" | "typed"): ReadResult {
  const status = source === "typed" ? "confirmed" : "probable";
  const toItem = (raw: string, kind: Item["kind"]): Item => ({
    kind,
    raw,
    status,
    words: [],
    photo: null,
    boxes: [],
    sources: [source],
    engines_agree: null,
    needs_review: source !== "typed",
    note: "",
  });
  const items: Item[] = [
    ...e.ingredients.map((i) => toItem(i.raw, STATEMENT.test(i.raw) ? "statement" : "ingredient")),
    ...e.allergen_statements.map((s) => toItem(s, "statement")),
  ];
  const warnings: string[] = [];
  if (source !== "typed") {
    warnings.push(
      source === "claude"
        ? "Read by AI only, without a second reading to check it against. Check every item against the label."
        : "Read on your phone without AI. Spelling mistakes are likely. Check every item against the label.",
    );
  }
  if (e.unreadable_regions) {
    items.push({ ...toItem("", "missing"), status: "missing", note: "Part of the list was cut off or unreadable in the photo." });
  }
  if (!items.some((i) => i.kind === "statement") && source !== "typed") {
    warnings.push(
      'No allergen statement ("Contains..." / "May contain...") was read. That does NOT mean the product has none. Check the label.',
    );
  }
  return {
    pipeline: {
      ocr: source === "tesseract" ? "Tesseract (on device)" : source === "claude" ? "none" : "typed",
      variants: [],
      claude: source === "claude" ? "claude" : null,
      claude_prompt: null,
      calibration: "single reader, not cross-checked",
    },
    photos: [],
    items,
    allergen_section_uncertain: source !== "typed",
    warnings,
    text: e.ingredients.map((i) => i.raw).join(", "),
  };
}
