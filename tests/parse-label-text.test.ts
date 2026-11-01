import { describe, expect, it } from "vitest";
import { normaliseExtraction } from "@/lib/ai/schemas";
import { parseIngredient, parseLabelText, splitTopLevel } from "@/lib/normalise/parse-label-text";

describe("splitTopLevel", () => {
  it("ignores commas inside brackets", () => {
    expect(splitTopLevel("sugar, chocolate (cocoa, sugar), salt")).toEqual([
      "sugar",
      "chocolate (cocoa, sugar)",
      "salt",
    ]);
  });

  it("handles nested and square brackets", () => {
    expect(splitTopLevel("a [b, c (d, e)], f")).toEqual(["a [b, c (d, e)]", "f"]);
  });
});

describe("parseIngredient", () => {
  it("reads INS numbers given as bare numbers in brackets", () => {
    const i = parseIngredient("Emulsifier (322, 471)");
    expect(i.codes).toEqual(["INS 322", "E322", "INS 471", "E471"]);
    expect(i.sub_ingredients).toEqual([]);
    expect(i.canonical).toBe("emulsifier");
  });

  it("reads E-numbers and percentages", () => {
    const i = parseIngredient("Colour E150d 0.5%");
    expect(i.codes).toContain("E150D");
    expect(i.percent).toBe(0.5);
  });

  it("splits compound ingredients into sub-ingredients", () => {
    const i = parseIngredient("Chocolate 20% (sugar, cocoa butter, emulsifier (soy lecithin))");
    expect(i.percent).toBe(20);
    expect(i.sub_ingredients.map((s) => s.raw)).toEqual([
      "sugar",
      "cocoa butter",
      "emulsifier (soy lecithin)",
    ]);
  });
});

describe("parseLabelText", () => {
  const label =
    "INGREDIENTS: Refined wheat flour (maida), sugar, palm oil, invert syrup, " +
    "raising agents (503(ii), 500(ii)), salt, emulsifier (INS 322). " +
    "Contains: wheat, soy. May contain traces of milk.";

  it("extracts ingredients in order and pulls out allergen statements", () => {
    const e = parseLabelText(label);
    expect(e.ingredients.map((i) => i.canonical)).toEqual([
      "refined wheat flour",
      "sugar",
      "palm oil",
      "invert syrup",
      "raising agents",
      "salt",
      "emulsifier",
    ]);
    expect(e.allergen_statements).toEqual(["Contains: wheat, soy.", "May contain traces of milk."]);
    expect(e.ingredients.at(-1)!.codes).toEqual(["INS 322", "E322"]);
  });

  it("marks OCR results as needing review", () => {
    const e = parseLabelText("Ingredients: sugar, s@lt, ©©", { fromOcr: true });
    expect(e.ingredients.find((i) => i.raw === "sugar")!.confidence).toBeGreaterThanOrEqual(0.7);
    expect(e.ingredients.find((i) => i.raw === "s@lt")!.confidence).toBeLessThan(0.75);
    expect(e.notes).not.toBe("");
  });

  it("re-joins words hyphenated across lines", () => {
    const e = parseLabelText("Ingredients: emul-\nsifier, salt");
    expect(e.ingredients[0].raw).toBe("emulsifier");
  });
});

describe("normaliseExtraction", () => {
  it("clamps confidence and drops impossible percentages", () => {
    const out = normaliseExtraction({
      product_name_guess: null,
      language: "en",
      allergen_statements: [" Contains: Soy "],
      unreadable_regions: false,
      notes: "",
      ingredients: [
        { raw: " Sugar ", canonical: "Sugar", codes: ["e322", "E322"], percent: 140, confidence: 1.4, sub_ingredients: [] },
        { raw: "  ", canonical: "", codes: [], percent: null, confidence: 0.5, sub_ingredients: [] },
      ],
    });
    expect(out.ingredients).toHaveLength(1);
    expect(out.ingredients[0]).toMatchObject({ raw: "Sugar", canonical: "sugar", codes: ["E322"], percent: null, confidence: 1 });
    expect(out.allergen_statements).toEqual(["Contains: Soy"]);
  });
});

describe("bracketed alternate names", () => {
  it("keeps a single bracketed name as part of the item", () => {
    const i = parseIngredient("Refined wheat flour (maida)");
    expect(i.sub_ingredients).toEqual([]);
    expect(i.raw).toBe("Refined wheat flour (maida)");
  });
});
