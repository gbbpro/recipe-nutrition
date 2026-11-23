import { describe, expect, it } from "vitest";
import { parseLine, parseRecipe, parseYield } from "../parse";

const p = (s: string) => parseLine(s, 0);

describe("parseLine — quantities", () => {
  it.each([
    ["1 1/2 cups flour", 1.5],
    ["1½ cups milk", 1.5],
    ["1 ½ cups milk", 1.5],
    ["0.5 cup oil", 0.5],
    ["3/4 c. water", 0.75],
    ["one cup sugar", 1],
    ["a pinch of salt", 1],
    ["an egg", 1],
    ["half a cup of sugar", 0.5],
  ])("%s → %d", (line, qty) => {
    expect(p(line).quantity).toBeCloseTo(qty);
  });

  it("uses the midpoint of ranges and keeps the bounds", () => {
    const l = p("2-3 cloves garlic, minced");
    expect(l.quantity).toBe(2.5);
    expect([l.quantityMin, l.quantityMax]).toEqual([2, 3]);
    expect(l.unit).toBe("clove");
    expect(l.name).toBe("garlic");
  });

  it("handles 'to' ranges", () => {
    const l = p("2 to 3 tablespoons honey");
    expect(l.quantity).toBe(2.5);
    expect(l.unit).toBe("tablespoon");
  });

  it("expands dozen", () => {
    const l = p("1 dozen eggs");
    expect(l.quantity).toBe(12);
    expect(l.unit).toBeNull();
  });
});

describe("parseLine — units", () => {
  it("distinguishes T (tablespoon) from t (teaspoon)", () => {
    expect(p("1 T olive oil").unit).toBe("tablespoon");
    expect(p("1 t vanilla").unit).toBe("teaspoon");
  });

  it("treats oz as fluid ounces for liquids and weight otherwise", () => {
    expect(p("8 oz milk").unit).toBe("fluid ounce");
    expect(p("8 oz milk").unitKind).toBe("volume");
    expect(p("8 oz cheddar cheese, shredded").unit).toBe("ounce");
    expect(p("8 oz cream cheese").unitKind).toBe("mass");
  });

  it("moves size words out of the unit slot", () => {
    const l = p("2 large eggs");
    expect(l.size).toBe("large");
    expect(l.unit).toBeNull();
    expect(l.unitKind).toBe("none");
    expect(p("1 extra-large egg").size).toBe("extra large");
    expect(p("2 medium onions, chopped").size).toBe("medium");
  });

  it("recognizes count units parse-ingredient doesn't know", () => {
    const l = p("2 slices bread");
    expect(l.unit).toBe("slice");
    expect(l.unitKind).toBe("count");
    expect(l.name).toBe("bread");
  });

  it("prefers a stated weight over a volume", () => {
    const l = p("1 cup (125 g) all-purpose flour");
    expect(l.quantity).toBe(125);
    expect(l.unit).toBe("gram");
  });
});

describe("parseLine — packages", () => {
  it("reads a parenthetical package size", () => {
    const l = p("1 (14 oz) can diced tomatoes");
    expect(l.unit).toBe("can");
    expect(l.packageSize).toEqual({ quantity: 14, unit: "ounce", unitKind: "mass" });
    expect(l.name).toBe("diced tomatoes");
  });

  it("reads '1 14-ounce can'", () => {
    const l = p("1 14-ounce can coconut milk");
    expect(l.unit).toBe("can");
    expect(l.packageSize?.quantity).toBe(14);
    expect(l.name).toBe("coconut milk");
  });

  it("reads 'can (15 oz)'", () => {
    expect(p("1 can (15 oz) chickpeas").packageSize?.quantity).toBe(15);
  });
});

describe("parseLine — names and notes", () => {
  it("splits prep notes from the name", () => {
    const l = p("1 1/2 cups all-purpose flour, sifted");
    expect(l.name).toBe("all-purpose flour");
    expect(l.notes).toEqual(["sifted"]);
  });

  it("keeps multiple notes", () => {
    expect(p("2 cans black beans, drained and rinsed").notes).toEqual(["drained", "rinsed"]);
  });

  it("takes the first of 'or' alternatives", () => {
    const l = p("1 stick butter or margarine");
    expect(l.name).toBe("butter");
    expect(l.alternatives).toEqual(["margarine"]);
    expect(p("1 cup butter/margarine").name).toBe("butter");
  });

  it("flags optional ingredients but still counts them", () => {
    const l = p("1 cup walnuts, chopped (optional)");
    expect(l.optional).toBe(true);
    expect(l.kind).toBe("ingredient");
    expect(l.name).toBe("walnuts");
  });

  it("converts 'juice of 1 lemon' to tablespoons", () => {
    const l = p("Juice of 1 lemon");
    expect(l.quantity).toBe(3);
    expect(l.unit).toBe("tablespoon");
    expect(l.name).toBe("lemon juice");
    expect(l.notes).toContain("estimated juice yield");
  });

  it("strips list bullets", () => {
    expect(p("- 2 cups sugar").name).toBe("sugar");
    expect(p("• 2 cups sugar").quantity).toBe(2);
  });
});

describe("parseLine — exclusions", () => {
  it.each([
    ["salt to taste", "to taste"],
    ["Salt and pepper, to taste", "to taste"],
    ["vegetable oil, for frying", "for frying"],
    ["fresh parsley, for garnish", "for garnish"],
  ])("excludes %s", (line, reason) => {
    const l = p(line);
    expect(l.kind).toBe("excluded");
    expect(l.excludedReason).toBe(reason);
  });

  it("keeps a measured amount even with 'plus more to taste'", () => {
    const l = p("1/2 tsp. kosher salt, plus more to taste");
    expect(l.kind).toBe("ingredient");
    expect(l.quantity).toBe(0.5);
    expect(l.name).toBe("kosher salt");
  });

  it("leaves unmeasured ingredients for review rather than excluding", () => {
    const l = p("Eggs");
    expect(l.kind).toBe("ingredient");
    expect(l.quantity).toBeNull();
  });
});

describe("parseRecipe", () => {
  it("tracks section headers and servings", () => {
    const r = parseRecipe(`Serves 4

For the dough:
2 cups flour
For the filling:
1 cup sugar`);
    expect(r.servings).toBe(4);
    expect(r.lines.map((l) => l.kind)).toEqual(["header", "ingredient", "header", "ingredient"]);
    expect(r.lines[1].group).toBe("dough");
    expect(r.lines[3].group).toBe("filling");
    expect(r.lines.map((l) => l.index)).toEqual([0, 1, 2, 3]);
  });

  it.each([
    ["Serves 4", 4],
    ["Servings: 6", 6],
    ["Makes 12 muffins", 12],
    ["Yield: 8-10 servings", 8],
    ["2 cups flour", null],
  ])("parseYield(%s) → %s", (line, n) => {
    expect(parseYield(line)).toBe(n);
  });
});
