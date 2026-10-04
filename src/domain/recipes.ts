// Dishes (D27): a recipe is ingredients for one portion; in a meal it becomes one line with a copy of them.
import type { MealItem, Recipe } from './types';

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
  return { ...item, grams: sumGrams(components), recipe: { ...item.recipe, portions }, components };
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
