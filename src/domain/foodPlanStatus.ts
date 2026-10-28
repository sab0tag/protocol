import { allergyHits, planAllergies } from './allergens';
import { dietCoverage } from './diets';
import type { ItemCheck } from './rules';
import type { Food, MealItem, Plan } from './types';
/** Existing rule results plus composition coverage; no new clinical decision or safety guarantee. */
export function foodPlanStatus(checks: ItemCheck[], foods: Map<string, Food>, plan: Plan | undefined) {
  const allergies = planAllergies(plan), found = new Set<string>();
  let incomplete = dietCoverage(plan).some(c => !c.configured);
  const walk = (item: MealItem) => {
    if (item.components?.length) { item.components.forEach(walk); return; }
    const food = item.foodId ? foods.get(item.foodId) : undefined;
    if (item.est || !food || (food.custom && !food.allergens)) { incomplete = true; return; }
    allergyHits(food, allergies).forEach(a => found.add(a));
  };
  checks.forEach(c => walk(c.item));
  const reasons = [...new Set(checks.flatMap(c => c.hits.map(h => h.message)))];
  return { state: found.size ? 'allergen' as const : incomplete ? 'incomplete' as const : reasons.length ? 'attention' as const : 'clear' as const, reasons, allergens: [...found] };
}
