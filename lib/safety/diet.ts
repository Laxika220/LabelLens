// Deterministic dietary-pattern checks. Like allergens: "contains" when an
// ingredient clearly conflicts, "source_unknown" when it often does but the
// label doesn't say, and nothing is ever reported as "suitable".

import { normalise } from "./allergen-matcher";
import { ALLERGEN_BY_ID } from "./synonyms";

export type DietId = "vegetarian" | "vegan" | "jain" | "halal" | "kosher";

type Rule = { definite: string[]; possible: { term: string; why: string }[]; codes?: string[] };

const MEAT = ["meat", "chicken", "mutton", "lamb", "goat meat", "beef", "pork", "bacon", "ham", "lard", "tallow", "suet", "gelatin", "gelatine", "bone", "animal fat", "chicken fat", "chicken extract", "beef extract", "meat extract", "collagen", "isinglass", "rennet", "anchovy", "shrimp", "prawn", "crab", "squid"];
const FISH = ALLERGEN_BY_ID.fish.definite;
const EGG = ALLERGEN_BY_ID.egg.definite;
const MILK = ALLERGEN_BY_ID.milk.definite;
const INSECT_CODES = ["120", "904"]; // carmine (cochineal), shellac

export const DIET_LABEL: Record<DietId, string> = {
  vegetarian: "Vegetarian (no meat, fish or egg)",
  vegan: "Vegan",
  jain: "Jain",
  halal: "Halal",
  kosher: "Kosher",
};

const RULES: Record<DietId, Rule> = {
  vegetarian: {
    definite: [...MEAT, ...FISH, ...EGG, "carmine", "cochineal"],
    possible: [
      { term: "emulsifier (471)", why: "mono- and diglycerides can be made from animal fat" },
      { term: "natural flavour", why: "natural flavours can be animal-derived" },
      { term: "enzymes", why: "enzymes can be animal-derived (e.g. rennet)" },
      { term: "vitamin d3", why: "vitamin D3 is often made from lanolin (sheep wool) or fish oil" },
    ],
    codes: ["120", "441", "542", "904", "1105"],
  },
  vegan: {
    definite: [...MEAT, ...FISH, ...EGG, ...MILK, "honey", "beeswax", "shellac", "carmine", "cochineal", "lanolin", "royal jelly", "propolis"],
    possible: [
      { term: "emulsifier (471)", why: "mono- and diglycerides can be made from animal fat" },
      { term: "natural flavour", why: "natural flavours can be animal-derived" },
      { term: "vitamin d3", why: "vitamin D3 is often made from lanolin or fish oil" },
      { term: "sugar", why: "some cane sugar is refined with bone char; the process isn't stated" },
    ],
    codes: ["120", "441", "542", "901", "904", "913", "966", "1105"],
  },
  jain: {
    definite: [...MEAT, ...FISH, ...EGG, "honey", "onion", "garlic", "potato", "carrot", "beetroot", "radish", "ginger", "yam", "sweet potato", "arbi", "shallot", "leek", "lahsun", "pyaz", "aloo", "adrak", "mooli"],
    possible: [
      { term: "onion powder", why: "listed separately in case your practice treats dried onion differently" },
      { term: "spices and condiments", why: "spice blends often include dried ginger, garlic or onion" },
      { term: "turmeric", why: "turmeric is a root; some Jain practice avoids it fresh but accepts it dried" },
      { term: "natural flavour", why: "natural flavours can include onion or garlic" },
    ],
    codes: ["120", "441", "542", "904"],
  },
  halal: {
    definite: ["pork", "bacon", "ham", "lard", "pig", "swine", "alcohol", "ethanol", "wine", "rum", "beer", "brandy", "whisky", "liqueur", "carmine"],
    possible: [
      { term: "gelatin", why: "gelatin can be from pork; the source isn't stated" },
      { term: "gelatine", why: "gelatin can be from pork; the source isn't stated" },
      { term: "emulsifier (471)", why: "mono- and diglycerides can be made from animal fat" },
      { term: "natural flavour", why: "flavourings can be carried in alcohol" },
      { term: "vanilla extract", why: "vanilla extract is usually made with alcohol" },
      { term: "enzymes", why: "enzymes can be animal-derived" },
      { term: "meat", why: "meat must be from halal slaughter; the label doesn't say" },
      { term: "chicken", why: "meat must be from halal slaughter; the label doesn't say" },
      { term: "mutton", why: "meat must be from halal slaughter; the label doesn't say" },
    ],
    codes: ["120", "441", "542", "904"],
  },
  kosher: {
    definite: ["pork", "bacon", "ham", "lard", "pig", "swine", "shrimp", "prawn", "crab", "lobster", "squid", "octopus", "oyster", "mussel", "clam", "carmine"],
    possible: [
      { term: "gelatin", why: "gelatin source and certification aren't stated" },
      { term: "gelatine", why: "gelatin source and certification aren't stated" },
      { term: "wine", why: "wine needs kosher certification; the label doesn't say" },
      { term: "emulsifier (471)", why: "mono- and diglycerides can be made from animal fat" },
      { term: "natural flavour", why: "flavour sources aren't stated" },
    ],
    codes: ["120", "441", "542", "904"],
  },
};

export type DietAlert = { diet: DietId; label: string; level: "contains" | "source_unknown"; ingredient: string; term: string; why: string };

// Phrases that contain an animal-product word but aren't one. Blanked out
// longest first, so "eggless mayonnaise" goes as a whole.
const LOOKALIKES = [...new Set([...ALLERGEN_BY_ID.egg.exclude, ...ALLERGEN_BY_ID.milk.exclude])].sort((a, b) => b.length - a.length);

function maskLookalikes(text: string): string {
  return LOOKALIKES.reduce((t, ex) => t.replace(new RegExp(`(?<![a-z0-9])${escape(ex)}(?![a-z0-9])`, "g"), " "), text);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, term: string) => new RegExp(`(?<![a-z0-9])${escape(term)}(?:e?s)?(?![a-z0-9])`).test(text);

export function matchDiets(ingredients: string[], diets: DietId[]): DietAlert[] {
  const out: DietAlert[] = [];
  for (const diet of diets) {
    const rule = RULES[diet];
    for (const raw of ingredients) {
      const text = maskLookalikes(normalise(raw));
      const definite = [...rule.definite].sort((a, b) => b.length - a.length).find((t) => has(text, t));
      const codes = [...text.matchAll(/(?<![\d.])(?:e|ins)?\s?(\d{3,4})[a-f]?(?![\d.%])/g)].map((m) => m[1]);
      const code = codes.find((c) => rule.codes?.includes(c));
      if (definite || code) {
        const term = definite ?? `INS ${code}`;
        const why = code && !definite
          ? `INS/E ${code} is ${INSECT_CODES.includes(code) ? "insect-derived" : "usually animal-derived"}.`
          : `"${definite}" doesn't fit a ${DIET_LABEL[diet].toLowerCase()} diet.`;
        out.push({ diet, label: DIET_LABEL[diet], level: "contains", ingredient: raw, term, why });
        continue;
      }
      const possible = rule.possible.find((p) => has(text, p.term) || (p.term === "emulsifier (471)" && codes.includes("471")));
      if (possible) out.push({ diet, label: DIET_LABEL[diet], level: "source_unknown", ingredient: raw, term: possible.term, why: `Source not stated: ${possible.why}.` });
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "contains" ? -1 : 1));
}
