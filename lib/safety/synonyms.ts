// Curated allergen term table used by the deterministic matcher.
//
// Allergen groups follow India's FSSAI labelling rules (cereals containing
// gluten, crustaceans, milk, eggs, fish, peanuts, tree nuts, soybeans,
// sulphites) plus the remaining EU-14 groups (celery, mustard, sesame,
// lupin, molluscs) because many users are advised about those too.
//
// Three kinds of term per allergen:
//   definite - the ingredient is (or is made from) the allergen
//   possible - the ingredient is often, but not always, made from it and
//              the label doesn't say which ("lecithin", "maltodextrin")
//   exclude  - phrases that contain an allergen word but aren't it
//              ("coconut milk", "cocoa butter", "buckwheat")
// Matching is whole-word and case-insensitive. When in doubt a term goes in
// "possible": a false alarm costs a second look; a miss can cost a reaction.

export type AllergenId =
  | "gluten"
  | "wheat"
  | "milk"
  | "egg"
  | "peanut"
  | "tree_nut"
  | "soy"
  | "fish"
  | "crustacean"
  | "mollusc"
  | "sesame"
  | "mustard"
  | "celery"
  | "lupin"
  | "sulphite";

export type AllergenEntry = {
  id: AllergenId;
  label: string;
  definite: string[];
  possible: { term: string; why: string }[];
  exclude: string[];
  codes?: string[]; // INS/E numbers that are always this allergen
  possibleCodes?: { code: string; why: string }[];
};

export const ALLERGENS: AllergenEntry[] = [
  {
    id: "wheat",
    label: "Wheat",
    definite: [
      "wheat", "wheat flour", "whole wheat", "atta", "maida", "refined flour", "semolina", "suji", "sooji", "rava",
      "durum", "spelt", "kamut", "bulgur", "couscous", "farina", "seitan", "wheat gluten", "vital wheat gluten",
      "wheat starch", "wheat bran", "wheat germ", "dalia", "daliya", "triticale", "einkorn", "emmer", "graham flour",
    ],
    possible: [
      { term: "flour", why: "the type of flour isn't stated" },
      { term: "starch", why: "the plant source of the starch isn't stated" },
      { term: "modified starch", why: "the plant source of the starch isn't stated" },
      { term: "maltodextrin", why: "usually made from maize, sometimes from wheat; the source isn't stated" },
      { term: "dextrin", why: "can be made from wheat; the source isn't stated" },
      { term: "hydrolysed vegetable protein", why: "often made from wheat or soy; the source isn't stated" },
      { term: "hydrolyzed vegetable protein", why: "often made from wheat or soy; the source isn't stated" },
      { term: "asafoetida", why: "compounded asafoetida (hing) is usually blended with wheat flour" },
      { term: "hing", why: "compounded hing is usually blended with wheat flour" },
      { term: "noodles", why: "noodles are often wheat-based; the flour isn't stated" },
      { term: "bread crumbs", why: "usually wheat-based" },
      { term: "breadcrumbs", why: "usually wheat-based" },
    ],
    exclude: ["buckwheat", "wheatgrass"],
  },
  {
    id: "gluten",
    label: "Gluten (cereals containing gluten)",
    definite: [
      "gluten", "barley", "rye", "oats", "oat", "malt", "malt extract", "barley malt", "malted barley", "malt vinegar",
      "jau", "spelt", "triticale", "kamut", "oat flour", "rolled oats", "oatmeal", "barley flour", "rye flour",
      // everything wheat-based is also gluten:
      "wheat", "wheat flour", "whole wheat", "atta", "maida", "refined flour", "semolina", "suji", "sooji", "rava",
      "durum", "bulgur", "couscous", "farina", "seitan", "dalia", "daliya", "graham flour",
    ],
    possible: [
      { term: "maltodextrin", why: "usually made from maize, sometimes from wheat; the source isn't stated" },
      { term: "modified starch", why: "the plant source of the starch isn't stated" },
      { term: "starch", why: "the plant source of the starch isn't stated" },
      { term: "flour", why: "the type of flour isn't stated" },
      { term: "hydrolysed vegetable protein", why: "often made from wheat; the source isn't stated" },
      { term: "hydrolyzed vegetable protein", why: "often made from wheat; the source isn't stated" },
      { term: "asafoetida", why: "compounded asafoetida (hing) is usually blended with wheat flour" },
      { term: "hing", why: "compounded hing is usually blended with wheat flour" },
      { term: "soy sauce", why: "traditionally brewed with wheat" },
      { term: "yeast extract", why: "can be made from brewer's (barley) yeast" },
    ],
    exclude: ["buckwheat", "gluten free", "gluten-free", "wheatgrass", "malt dextrin"],
  },
  {
    id: "milk",
    label: "Milk",
    definite: [
      "milk", "milk solids", "milk powder", "skimmed milk", "skim milk", "whole milk", "milk fat", "milkfat", "butter",
      "butter oil", "butterfat", "cream", "ghee", "curd", "dahi", "yoghurt", "yogurt", "cheese", "paneer", "khoa",
      "khoya", "mawa", "chhena", "chhana", "malai", "lassi", "buttermilk", "chaas", "whey", "whey powder", "whey protein",
      "whey protein concentrate", "whey protein isolate", "casein", "caseinate", "sodium caseinate", "calcium caseinate",
      "lactose", "lactalbumin", "lactoglobulin", "milk protein", "condensed milk", "evaporated milk", "dairy solids",
      "ice cream", "kulfi", "rabri", "custard",
    ],
    possible: [
      { term: "artificial flavouring substances - milk", why: "a milk-type flavour; may or may not contain milk" },
      { term: "lactic acid", why: "usually made by fermenting sugars, not from milk; listed in case the source matters to you" },
    ],
    exclude: [
      "coconut milk", "coconut cream", "almond milk", "soy milk", "soya milk", "oat milk", "rice milk", "cashew milk",
      "cocoa butter", "peanut butter", "nut butter", "shea butter", "kokum butter", "mango butter", "apple butter",
      "cream of tartar", "milk thistle", "butter beans", "butterscotch flavour", "creamer non dairy",
    ],
  },
  {
    id: "egg",
    label: "Egg",
    definite: [
      "egg", "eggs", "egg white", "egg yolk", "egg powder", "whole egg", "dried egg", "albumen", "albumin", "ovalbumin",
      "ovomucoid", "lysozyme", "mayonnaise", "meringue", "egg lecithin",
    ],
    possible: [{ term: "lecithin", why: "lecithin can come from egg, soy or sunflower; the source isn't stated" }],
    exclude: [
      "eggless", "eggplant", "egg-free", "egg free", "eggless mayonnaise", "vegan mayonnaise",
      "soy lecithin", "soya lecithin", "sunflower lecithin", "rapeseed lecithin",
    ],
    codes: ["1105"],
  },
  {
    id: "peanut",
    label: "Peanut",
    definite: [
      "peanut", "peanuts", "groundnut", "groundnuts", "ground nut", "arachis", "arachis oil", "monkey nut", "monkey nuts",
      "mungfali", "moongphali", "peanut butter", "peanut oil", "groundnut oil", "hydrolysed groundnut protein",
    ],
    possible: [
      { term: "nuts", why: "\"nuts\" without a type could mean peanuts or tree nuts" },
      { term: "edible vegetable oil", why: "the oil's plant source isn't stated (it could be groundnut oil)" },
      { term: "vegetable oil", why: "the oil's plant source isn't stated (it could be groundnut oil)" },
    ],
    exclude: ["peanut free", "peanut-free"],
  },
  {
    id: "tree_nut",
    label: "Tree nuts",
    definite: [
      "almond", "almonds", "badam", "cashew", "cashews", "cashew nut", "kaju", "walnut", "walnuts", "akhrot", "hazelnut",
      "hazelnuts", "pistachio", "pistachios", "pista", "pecan", "pecans", "brazil nut", "brazil nuts", "macadamia",
      "pine nut", "pine nuts", "chilgoza", "praline", "marzipan", "almond milk", "cashew milk", "almond paste",
      "cashew paste", "nut butter", "gianduja", "tree nuts", "tree nut",
    ],
    possible: [
      { term: "nuts", why: "\"nuts\" without a type could mean tree nuts or peanuts" },
      { term: "chironji", why: "a seed from a tree (Buchanania lanzan); some people with tree-nut allergy react to it" },
      { term: "coconut", why: "classed as a tree nut by some authorities; most people with tree-nut allergy tolerate it" },
      { term: "natural flavour", why: "natural flavours can be nut-derived; the source isn't stated" },
    ],
    exclude: ["nutmeg", "butternut", "water chestnut", "doughnut", "donut"],
  },
  {
    id: "soy",
    label: "Soy",
    definite: [
      "soy", "soya", "soybean", "soybeans", "soyabean", "soya bean", "soy protein", "soy protein isolate", "soya flour",
      "soy flour", "soya chunks", "soy lecithin", "soya lecithin", "soy sauce", "tofu", "tempeh", "miso", "edamame",
      "soy milk", "soya milk", "textured vegetable protein", "soybean oil", "soyabean oil",
    ],
    possible: [
      { term: "lecithin", why: "lecithin is most often from soy, but can be from sunflower or egg; the source isn't stated" },
      { term: "lecithins", why: "lecithin is most often from soy, but can be from sunflower or egg; the source isn't stated" },
      { term: "hydrolysed vegetable protein", why: "often made from soy or wheat; the source isn't stated" },
      { term: "hydrolyzed vegetable protein", why: "often made from soy or wheat; the source isn't stated" },
      { term: "edible vegetable oil", why: "the oil's plant source isn't stated (it could be soybean oil)" },
      { term: "vegetable oil", why: "the oil's plant source isn't stated (it could be soybean oil)" },
    ],
    exclude: ["sunflower lecithin", "egg lecithin", "rapeseed lecithin"],
    possibleCodes: [{ code: "322", why: "INS 322 (lecithin) is most often from soy; the source isn't stated" }],
  },
  {
    id: "fish",
    label: "Fish",
    definite: [
      "fish", "fish sauce", "fish oil", "fish meat", "fish extract", "anchovy", "anchovies", "tuna", "salmon", "mackerel",
      "sardine", "sardines", "cod", "pollock", "tilapia", "pomfret", "rohu", "hilsa", "bombay duck", "surimi",
      "fish gelatin", "isinglass", "worcestershire sauce",
    ],
    possible: [{ term: "omega 3", why: "omega-3 is often from fish oil; the source isn't stated" }],
    exclude: ["fish free", "goldfish"],
  },
  {
    id: "crustacean",
    label: "Crustaceans",
    definite: ["prawn", "prawns", "shrimp", "shrimps", "crab", "lobster", "crayfish", "krill", "jhinga", "crustacean", "crustaceans", "shrimp paste"],
    possible: [],
    exclude: [],
  },
  {
    id: "mollusc",
    label: "Molluscs",
    definite: ["squid", "octopus", "cuttlefish", "oyster", "oysters", "oyster sauce", "mussel", "mussels", "clam", "clams", "scallop", "scallops", "snail", "abalone", "mollusc", "molluscs"],
    possible: [],
    exclude: [],
  },
  {
    id: "sesame",
    label: "Sesame",
    definite: ["sesame", "sesame seeds", "sesame oil", "til", "gingelly", "gingelly oil", "tahini", "tahina", "benne"],
    possible: [],
    exclude: [],
  },
  {
    id: "mustard",
    label: "Mustard",
    definite: ["mustard", "mustard seeds", "mustard oil", "mustard powder", "rai", "sarson", "kasundi"],
    possible: [{ term: "spices and condiments", why: "spice blends often include mustard; the blend isn't listed" }],
    exclude: [],
  },
  {
    id: "celery",
    label: "Celery",
    definite: ["celery", "celeriac", "celery seed", "celery salt"],
    possible: [{ term: "spices and condiments", why: "spice blends may include celery seed; the blend isn't listed" }],
    exclude: [],
  },
  {
    id: "lupin",
    label: "Lupin",
    definite: ["lupin", "lupine", "lupin flour"],
    possible: [],
    exclude: [],
  },
  {
    id: "sulphite",
    label: "Sulphites",
    definite: [
      "sulphite", "sulphites", "sulfite", "sulfites", "sulphur dioxide", "sulfur dioxide", "metabisulphite",
      "metabisulfite", "sodium metabisulphite", "potassium metabisulphite", "sodium bisulphite", "sodium sulphite",
    ],
    possible: [{ term: "class ii preservative", why: "Class II preservatives in India include sulphites; the exact one isn't stated" }],
    exclude: [],
    codes: ["220", "221", "222", "223", "224", "225", "226", "227", "228"],
  },
];

export const ALLERGEN_BY_ID = Object.fromEntries(ALLERGENS.map((a) => [a.id, a])) as Record<AllergenId, AllergenEntry>;
