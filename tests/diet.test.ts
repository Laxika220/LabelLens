import { describe, expect, it } from "vitest";
import { matchDiets } from "@/lib/safety/diet";

const levels = (ings: string[], diet: Parameters<typeof matchDiets>[1][number]) => matchDiets(ings, [diet]).map((a) => `${a.level}:${a.term}`);

describe("diet checks", () => {
  it("Indian vegetarian excludes egg; eggless is fine", () => {
    expect(levels(["Egg (14%)"], "vegetarian")).toEqual(["contains:egg"]);
    expect(levels(["Eggless Mayonnaise"], "vegetarian")).toEqual([]);
  });
  it("vegan flags dairy, honey and insect colours", () => {
    expect(levels(["Milk Solids", "Honey", "Colour (120)"], "vegan")).toEqual(["contains:milk solids", "contains:honey", "contains:INS 120"]);
    expect(levels(["Coconut Milk"], "vegan")).toEqual([]);
  });
  it("Jain flags root vegetables", () => {
    expect(levels(["Onion Powder", "Garlic", "Tomato"], "jain")).toEqual(["contains:onion", "contains:garlic"]);
  });
  it("halal: gelatin source unknown, lard contains", () => {
    expect(levels(["Gelatin"], "halal")).toEqual(["source_unknown:gelatin"]);
    expect(levels(["Lard"], "halal")).toEqual(["contains:lard"]);
  });
  it("E471 is a possible animal source", () => {
    expect(levels(["Emulsifier (471)"], "vegetarian")).toEqual(["source_unknown:emulsifier (471)"]);
  });
});
