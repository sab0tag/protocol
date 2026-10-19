// Dishes (D27): a recipe is ingredients for one portion; in a meal it becomes one line with a copy of them.
import type { Food, MealItem, Recipe } from './types';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Ingredients for `portions` portions: grams and household quantities scale together. */
export function scaleItems(items: MealItem[], factor: number): MealItem[] {
  return items.map((it) => ({
    ...it, grams: Math.round(it.grams * factor),
    ...(it.unit ? { unit: { ...it.unit, qty: round1(it.unit.qty * factor) } } : {}),
    ...(it.manual ? { manual: { ...it.manual, kcal: it.manual.kcal * factor, protein: it.manual.protein * factor,
      fat: it.manual.fat * factor, carbs: it.manual.carbs * factor, calciumMg: (it.manual.calciumMg ?? 0) * factor } } : {}),
  }));
}

export const sumGrams = (items: MealItem[]) => items.reduce((g, it) => g + it.grams, 0);

export function dishItem(recipe: Recipe, portions = 1): MealItem {
  const components = scaleItems(recipe.items, portions);
  return { name: recipe.name, grams: sumGrams(components), recipe: { id: recipe.id, portions }, components };
}

/** Another number of portions of a dish already in the meal (its own edits to the ingredients are kept). */
export function setPortions(item: MealItem, portions: number): MealItem {
  if (!item.recipe || !item.components) return item;
  const components = scaleItems(item.components, portions / item.recipe.portions);
  return { ...item, grams: sumGrams(components), recipe: { id: item.recipe.id, portions }, components }; // in portions again (D106)
}

/** A dish's ingredients changed by hand: keep its weight in step. */
export function withComponents(item: MealItem, components: MealItem[]): MealItem {
  return { ...item, components, grams: sumGrams(components) };
}

/** «Зберегти як мою страву»: the meal's lines (dishes opened up) for one portion. */
export function recipeFrom(name: string, items: MealItem[], id: string): Recipe {
  const flat = items.flatMap((it) => (it.components?.length ? scaleItems(it.components, 1 / (it.recipe?.portions ?? 1)) : [it]))
    .map(({ recipe: _r, components: _c, ...rest }) => rest);
  return { id, name: name.trim(), items: flat };
}

/** D36: «У мою базу» — a free line (nutrients for the whole portion) becomes a food per 100 g; null without weight. */
export function foodFromLine(item: MealItem, id: string): Food | null {
  if (!item.manual || !(item.grams > 0) || !item.name.trim()) return null;
  const k = 100 / item.grams, r = (n: number) => Math.round(n * k * 10) / 10;
  const m = item.manual;
  return { id, name: item.name.trim(), custom: true, tags: [],
    per100g: { kcal: Math.round(m.kcal * k), protein: r(m.protein), fat: r(m.fat), carbs: r(m.carbs), calciumMg: Math.round((m.calciumMg ?? 0) * k) } };
}

/** D36: before an own food is deleted, lines that use it keep their nutrients as a free line. */
export function detachFood(items: MealItem[], food: Food): { items: MealItem[]; changed: boolean } {
  let changed = false;
  const walk = (xs: MealItem[]): MealItem[] => xs.map((it) => {
    if (it.components?.length) {
      const components = walk(it.components);
      return components === it.components ? it : { ...it, components };
    }
    if (it.foodId !== food.id) return it;
    changed = true;
    const k = it.grams / 100, p = food.per100g;
    const { foodId: _f, unit: _u, ...rest } = it;
    return { ...rest, manual: { kcal: p.kcal * k, protein: p.protein * k, fat: p.fat * k, carbs: p.carbs * k, calciumMg: (p.calciumMg ?? 0) * k } };
  });
  return { items: walk(items), changed };
}

/** D40: a free line weighed anew — its nutrients (for the whole portion) follow the weight. */
export function regram(it: MealItem, grams: number): MealItem {
  if (!it.manual || !(it.grams > 0)) return { ...it, grams };
  const k = grams / it.grams, m = it.manual;
  return { ...it, grams, manual: { kcal: m.kcal * k, protein: m.protein * k, fat: m.fat * k, carbs: m.carbs * k,
    ...(m.calciumMg !== undefined ? { calciumMg: m.calciumMg * k } : {}) } };
}
