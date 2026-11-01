import { describe, expect, it } from "vitest";
import { matchAllergens, type LabelLine } from "@/lib/safety/allergen-matcher";
import type { AllergenId } from "@/lib/safety/synonyms";

const ing = (...texts: string[]): LabelLine[] => texts.map((text) => ({ kind: "ingredient", text }));
const levelFor = (lines: LabelLine[], id: AllergenId, incomplete = false) =>
  matchAllergens(lines, [id], incomplete).map((a) => a.level);

describe("hidden synonyms map to their allergen", () => {
  it.each([
    ["Whey Protein Concentrate (22%)", "milk"],
    ["Sodium Caseinate", "milk"],
    ["Milk Solids (Khoa Powder) (45%)", "milk"],
    ["Paneer (40%) (Milk, Citric Acid)", "milk"],
    ["Ghee", "milk"],
    ["Semolina (Suji)", "wheat"],
    ["Durum Wheat Semolina", "wheat"],
    ["Refined Wheat Flour (Maida)", "gluten"],
    ["Barley Malt Extract", "gluten"],
    ["Rolled Oats (72%)", "gluten"],
    ["Hydrolysed Groundnut Protein", "peanut"],
    ["Almonds (2%)", "tree_nut"],
    ["Pista", "tree_nut"],
    ["Emulsifiers (Soya Lecithin, 476)", "soy"],
    ["Fish Meat (Mackerel) (20%)", "fish"],
    ["Prawn (8%)", "crustacean"],
    ["Til (Sesame Seeds)", "sesame"],
    ["Mustard Powder", "mustard"],
    ["Preservative (223)", "sulphite"],
    ["Preservative (INS 220)", "sulphite"],
    ["Egg (14%)", "egg"],
  ] as const)("%s → %s", (text, id) => {
    expect(levelFor(ing(text), id)).toEqual(["contains"]);
  });
});

describe("look-alikes are not false alarms", () => {
  it.each([
    ["Coconut Milk", "milk"],
    ["Cocoa Butter", "milk"],
    ["Peanut Butter", "milk"],
    ["Cream of Tartar", "milk"],
    ["Buckwheat Flour (Kuttu)", "gluten"],
    ["Buckwheat Flour (Kuttu)", "wheat"],
    ["Nutmeg", "tree_nut"],
    ["Eggplant", "egg"],
    ["Eggless Mayonnaise", "egg"],
    ["Sunflower Lecithin", "soy"],
  ] as const)("%s is not %s", (text, id) => {
    expect(levelFor(ing(text), id)).toEqual([]);
  });

  it("peanut and tree nut are separate", () => {
    expect(levelFor(ing("Roasted Peanuts (55%)"), "tree_nut")).toEqual([]);
    expect(levelFor(ing("Cashew Paste"), "peanut")).toEqual([]);
  });
});

describe("unknown sources stay unknown", () => {
  it("unqualified lecithin is a possible soy and egg source", () => {
    expect(levelFor(ing("Emulsifier (Lecithin)"), "soy")).toEqual(["source_unknown"]);
    expect(levelFor(ing("Emulsifier (Lecithin)"), "egg")).toEqual(["source_unknown"]);
    expect(levelFor(ing("Emulsifier (322)"), "soy")).toEqual(["source_unknown"]);
  });

  it("maltodextrin and hydrolysed vegetable protein are possible gluten sources", () => {
    expect(levelFor(ing("Maltodextrin"), "gluten")).toEqual(["source_unknown"]);
    expect(levelFor(ing("Hydrolysed Vegetable Protein"), "gluten")).toEqual(["source_unknown"]);
    expect(levelFor(ing("Hydrolysed Vegetable Protein"), "soy")).toEqual(["source_unknown"]);
  });

  it("a stated source qualifies the ingredient", () => {
    expect(levelFor(ing("Edible Vegetable Oil (Palm)"), "peanut")).toEqual([]);
    expect(levelFor(ing("Edible Vegetable Oil"), "peanut")).toEqual(["source_unknown"]);
    expect(levelFor(ing("Tapioca Starch (55%)"), "gluten")).toEqual([]);
    expect(levelFor(ing("Modified Starch"), "gluten")).toEqual(["source_unknown"]);
    expect(levelFor(ing("Gram Flour (Besan)"), "wheat")).toEqual([]);
  });

  it("compounded hing is a possible wheat source", () => {
    expect(levelFor(ing("Asafoetida"), "wheat")).toEqual(["source_unknown"]);
  });
});

describe("contains vs may contain", () => {
  it("separates allergen statements from precautionary ones", () => {
    const lines: LabelLine[] = [
      { kind: "ingredient", text: "Sugar" },
      { kind: "statement", text: "CONTAINS MILK, SOY AND HAZELNUT" },
      { kind: "statement", text: "MAY CONTAIN ALMOND, CASHEW AND WHEAT" },
    ];
    expect(levelFor(lines, "milk")).toEqual(["contains"]);
    expect(levelFor(lines, "wheat")).toEqual(["may_contain"]);
    expect(levelFor(lines, "tree_nut")).toEqual(["contains", "may_contain"]);
  });

  it("'made in a facility' is precautionary", () => {
    expect(levelFor([{ kind: "statement", text: "Made in a facility that also processes wheat." }], "wheat")).toEqual(["may_contain"]);
  });

  it("an unspecified 'nuts' warning flags both peanut and tree nut", () => {
    const lines: LabelLine[] = [{ kind: "statement", text: "May contain nuts" }];
    expect(levelFor(lines, "peanut")).toEqual(["may_contain"]);
    expect(levelFor(lines, "tree_nut")).toEqual(["may_contain"]);
  });
});

describe("never reports absence as safety", () => {
  it("returns nothing (not 'safe') when the reading was complete and nothing matched", () => {
    expect(matchAllergens(ing("Sugar", "Salt"), ["milk"], false)).toEqual([]);
  });

  it("returns cannot_rule_out when part of the label was unreadable", () => {
    const [a] = matchAllergens(ing("Sugar", "Salt"), ["milk"], true);
    expect(a.level).toBe("cannot_rule_out");
  });
});
