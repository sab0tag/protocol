// D110: a dish described in words → its ingredients, like a canteen's breakdown card (Харчоблок). The model only names
// the ingredients, their grams in the ready dish and — where the base has the same product in the same state — its base
// name; elsewhere its estimate per 100 g. Here every line is checked, a base food is taken by its exact name (its numbers,
// not the model's), an estimate is kept as an estimate (a free line with its own nutrients, marked), and the person
// corrects the grams before the dish is saved for one portion.
import { scaleItems } from './recipes';
import { normalize } from './nutrition';
import { ALLERGENS, EST_TAGS, type Allergen, type EstTag, type Food, type MealItem, type Nutrients } from './types';

export interface DishResult {
  readable: boolean;
  name: string;
  portions: number;
  items: { said: string; base: string; grams: number; amountSaid: boolean; kcal: number; protein: number; fat: number; carbs: number;
    tags?: string[]; allergens?: string[] }[];
  note: string;
}

/** One ingredient: from the base (its own numbers) or the model's estimate per 100 g; grams for the whole described dish. */
export interface DishLine { key: string; said: string; food?: Food; per100?: Nutrients; grams: number; amountSaid: boolean
  est?: { tags: EstTag[]; allergens: Allergen[] } }

const within = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const cap = (s: string) => s.charAt(0).toLocaleUpperCase('uk') + s.slice(1);

export function breakdown(r: DishResult, foods: Food[]): DishLine[] {
  const byName = new Map(foods.map((f) => [normalize(f.name), f]));
  return r.items.flatMap((x, i) => {
    const said = x.said.trim();
    const grams = Math.round(within(x.grams, 0, 3000) * 10) / 10;
    if (!said || !(grams > 0)) return [];
    const food = x.base.trim() ? byName.get(normalize(x.base)) : undefined;
    // an estimate that does not add up (protein + fat + carbs over 100 g, energy far from 4/9/4) is still shown — marked
    const per100 = food ? undefined : { kcal: within(x.kcal, 0, 900), protein: within(x.protein, 0, 100), fat: within(x.fat, 0, 100), carbs: within(x.carbs, 0, 100) };
    // D111: what the estimate is, from a closed list — the plan's check reads it; unknown words are dropped
    const est = food ? undefined : { tags: (x.tags ?? []).filter((t): t is EstTag => (EST_TAGS as readonly string[]).includes(t)),
      allergens: (x.allergens ?? []).filter((a): a is Allergen => (ALLERGENS as readonly string[]).includes(a)) };
    return [{ key: `i${i}`, said: cap(said), ...(food ? { food } : {}), ...(per100 ? { per100 } : {}), ...(est ? { est } : {}), grams, amountSaid: x.amountSaid }];
  });
}

/** A line as a meal line: a base food by its id, an estimate as a free line with nutrients for its grams. */
export function lineItem(l: DishLine): MealItem {
  if (l.food) return { foodId: l.food.id, name: l.food.name, grams: l.grams };
  const k = l.grams / 100, p = l.per100!;
  return { name: l.said, grams: l.grams, manual: { kcal: p.kcal * k, protein: p.protein * k, fat: p.fat * k, carbs: p.carbs * k,
    ...(p.calciumMg !== undefined ? { calciumMg: p.calciumMg * k } : {}) }, ...(l.est ? { est: l.est } : {}) }; // D131: a known calcium kept, an unknown one not made 0
}

/** The dish for one portion — what «Мої страви» keeps (D27). */
export function recipeItems(lines: DishLine[], portions: number): MealItem[] {
  const divisor = Math.max(1, portions);
  // scaleItems rounds grams to whole numbers for meal entry. A saved recipe must
  // retain fractional grams (e.g. 275 g / 2 = 137.5 g), or its nutrients drift.
  return scaleItems(lines.map(lineItem), 1 / divisor).map((it, i) => ({
    ...it, grams: Math.max(0.5, Math.round(lines[i]!.grams / divisor * 1000) / 1000),
  }));
}

/** A temporarily empty input is valid while editing, but never a committed portion count. */
export function parseDishPortions(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n <= 999 ? n : null;
}

/** Scale the recipe batch, retaining ingredient identities and nutrient estimates. */
export function scaleDishPortions(lines: DishLine[], previous: number, next: number): DishLine[] {
  if (previous <= 0 || next <= 0) return lines;
  return lines.map((line) => ({ ...line, grams: Math.round(line.grams * next / previous * 1000) / 1000 }));
}
