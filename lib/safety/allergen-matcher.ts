// Deterministic allergen matching. No AI is involved, and nothing here is
// ever softened by the later AI analysis.
//
// Levels, from most to least certain:
//   contains        - an ingredient is (made from) the allergen, or the label
//                     says "Contains ..."
//   may_contain     - precautionary statement ("May contain", "traces",
//                     "made in a facility that also handles ...")
//   source_unknown  - an ingredient that is often made from the allergen,
//                     but the label doesn't say what this one is made from
//   cannot_rule_out - nothing was found, but part of the label couldn't be
//                     read, so absence can't be assumed
// There is deliberately no "safe" level: not finding an allergen in the
// text is never reported as the product being free of it.

import { ALLERGENS, ALLERGEN_BY_ID, type AllergenEntry, type AllergenId } from "./synonyms";

export type Level = "contains" | "may_contain" | "source_unknown" | "cannot_rule_out";

export type AllergenAlert = {
  allergen: AllergenId;
  label: string;
  level: Level;
  ingredient: string | null; // the confirmed label line that triggered it
  term: string | null; // the word(s) that matched
  why: string;
};

export type LabelLine = { kind: "ingredient" | "statement"; text: string };

const PRECAUTION = /\b(may contain|may also contain|traces? of|made in a|prepared in a|produced in a|processed in a|manufactured in a|packed in a|facility|same line|cross[- ]contact)\b/i;

// A word before an unqualified term that names its source ("corn starch",
// "gram flour") makes it qualified. These words don't.
const GENERIC_PRECEDERS = new Set([
  "", "edible", "refined", "modified", "food", "native", "plain", "all", "purpose", "fortified", "enriched",
  "added", "natural", "and", "or", "of", "permitted", "pre", "gelatinised", "gelatinized", "vegetable",
  "hydrogenated", "partially", "interesterified", "blended", "mixed",
]);

export function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phrase = (term: string) => new RegExp(`(?<![a-z0-9])${escape(term).replace(/ /g, "[\\s-]+")}(?:e?s)?(?![a-z0-9])`, "g");

// Blank out excluded phrases so "coconut milk" can't match "milk".
function mask(text: string, entry: AllergenEntry): string {
  let out = text;
  // Longest first: "eggless mayonnaise" must be blanked whole, not reduced to
  // "mayonnaise" by the shorter "eggless".
  for (const ex of [...entry.exclude].sort((a, b) => b.length - a.length)) {
    out = out.replace(phrase(ex), (m) => " ".repeat(m.length));
  }
  return out;
}

function findDefinite(text: string, entry: AllergenEntry): string | null {
  // Longest terms first so "milk solids" is reported rather than "milk".
  for (const term of [...entry.definite].sort((a, b) => b.length - a.length)) {
    if (phrase(term).test(text)) return term;
  }
  return null;
}

function isQualified(text: string, start: number, end: number): boolean {
  const after = text.slice(end).match(/^\s*\(([^)]*)\)/);
  if (after && /[a-z]{3,}/.test(after[1])) return true; // "Edible Vegetable Oil (Palm)"
  const before = text.slice(0, start).match(/([a-z]+)\s*$/);
  return Boolean(before && !GENERIC_PRECEDERS.has(before[1])); // "Tapioca Starch"
}

function findPossible(text: string, entry: AllergenEntry): { term: string; why: string } | null {
  for (const p of [...entry.possible].sort((a, b) => b.term.length - a.term.length)) {
    for (const m of text.matchAll(phrase(p.term))) {
      if (!isQualified(text, m.index!, m.index! + m[0].length)) return p;
    }
  }
  return null;
}

function codesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\d.])(?:e|ins)?\s?-?(\d{3,4})[a-f]?(?:\([ivx]+\))?(?![\d.%])/gi)) out.push(m[1]);
  return out;
}

function matchLine(line: LabelLine, entry: AllergenEntry): AllergenAlert | null {
  const text = mask(normalise(line.text), entry);
  const base = { allergen: entry.id, label: entry.label, ingredient: line.text };

  if (line.kind === "statement") {
    const precaution = PRECAUTION.test(text);
    const term = findDefinite(text, entry) ?? (entry.possible.find((p) => phrase(p.term).test(text))?.term ?? null);
    if (!term) return null;
    return {
      ...base,
      level: precaution ? "may_contain" : "contains",
      term,
      why: precaution
        ? "The label warns it may contain this (risk of cross-contact during manufacturing)."
        : "The label's allergen statement lists this.",
    };
  }

  const definite = findDefinite(text, entry);
  if (definite) return { ...base, level: "contains", term: definite, why: `"${definite}" is a source of ${entry.label.toLowerCase()}.` };
  const codes = codesIn(text);
  const code = codes.find((c) => entry.codes?.includes(c));
  if (code) return { ...base, level: "contains", term: `INS ${code}`, why: `INS/E ${code} is a ${entry.label.toLowerCase()} ingredient.` };
  const possible = findPossible(text, entry);
  if (possible) return { ...base, level: "source_unknown", term: possible.term, why: `Source not stated: ${possible.why}.` };
  const pc = entry.possibleCodes?.find((p) => codes.includes(p.code));
  if (pc) return { ...base, level: "source_unknown", term: `INS ${pc.code}`, why: `Source not stated: ${pc.why}.` };
  return null;
}

const RANK: Record<Level, number> = { contains: 3, may_contain: 2, source_unknown: 1, cannot_rule_out: 0 };

/**
 * Check confirmed label lines against the allergens a person avoids.
 * `readIncomplete` must be true if any part of the label couldn't be read.
 * Returns every finding (several lines can match one allergen), strongest
 * first, plus a "cannot_rule_out" entry for each avoided allergen that
 * wasn't found while the reading was incomplete.
 */
export function matchAllergens(lines: LabelLine[], avoid: AllergenId[], readIncomplete: boolean): AllergenAlert[] {
  const alerts: AllergenAlert[] = [];
  for (const id of avoid) {
    const entry = ALLERGEN_BY_ID[id];
    const found = lines.map((l) => matchLine(l, entry)).filter((a): a is AllergenAlert => a !== null);
    if (found.length) alerts.push(...found);
    else if (readIncomplete) {
      alerts.push({
        allergen: id,
        label: entry.label,
        level: "cannot_rule_out",
        ingredient: null,
        term: null,
        why: "Not found in the text that was read, but part of the label couldn't be read, so it can't be ruled out.",
      });
    }
  }
  return alerts.sort((a, b) => RANK[b.level] - RANK[a.level]);
}

/** All allergen groups, for profile pickers. */
export const ALLERGEN_OPTIONS = ALLERGENS.map((a) => ({ id: a.id, label: a.label }));
