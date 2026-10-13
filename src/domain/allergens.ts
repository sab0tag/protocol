// D57: which of the 14 allergens a line or a meal holds — from its food, or from a dish's ingredients. A free line
// (no food behind it) is unknown, not «none»: it is reported as such, never counted as free of anything. Pure.
import { ALLERGENS, type Allergen, type Food, type MealItem } from './types';

const order = (xs: Set<Allergen>) => ALLERGENS.filter((a) => xs.has(a));

export function itemAllergens(item: MealItem, foods: Map<string, Food>): { allergens: Allergen[]; unknown: boolean } {
  const found = new Set<Allergen>();
  let unknown = false;
  const walk = (it: MealItem) => {
    if (it.components?.length) { it.components.forEach(walk); return; }
    const f = it.foodId ? foods.get(it.foodId) : undefined;
    if (!f) { unknown = true; return; }
    for (const a of f.allergens ?? []) found.add(a);
  };
  walk(item);
  return { allergens: order(found), unknown };
}

export function mealAllergens(items: MealItem[], foods: Map<string, Food>): Allergen[] {
  const all = new Set<Allergen>();
  for (const it of items) for (const a of itemAllergens(it, foods).allergens) all.add(a);
  return order(all);
}
