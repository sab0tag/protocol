// A photo's answer (server/src/photo.ts) → «Розпізнано» lines (D32). The base wins: a food or dish the model named
// from the person's list is counted from the base; anything else becomes a free line with the photo's estimate.
import { itemFor, searchFoods, type Recognized } from './foodSearch';
import { normalize } from './nutrition';
import { sumGrams } from './recipes';
import type { Cooking, Food, MealItem, Recipe } from './types';

export interface PhotoItem {
  name: string; match: string | null; grams: number; count: number | null;
  cooking: Cooking | 'unknown';
  kcal: number; protein: number; fat: number; carbs: number; confidence: 'high' | 'medium' | 'low';
}
export interface PhotoResult { items: PhotoItem[]; note: string | null }

const r1 = (n: number) => Math.round(n * 10) / 10;

export function fromPhoto(result: PhotoResult, foods: Food[], recipes: Recipe[], dishItem: (r: Recipe, portions: number) => MealItem,
  prefer: ReadonlySet<string> = new Set()): Recognized[] {
  const byName = <T extends { name: string }>(xs: T[], name: string | null) => (name ? xs.find((x) => normalize(x.name) === normalize(name)) : undefined);
  return result.items.filter((p) => p.grams > 0).map((p) => {
    const grams = Math.round(p.grams);
    const text = `${p.name} ≈ ${grams} г`;
    const unsure = p.confidence === 'low';
    const dish = byName(recipes, p.match);
    if (dish) {
      const one = sumGrams(dish.items) || grams;
      return { text, unsure, item: dishItem(dish, Math.max(0.5, Math.round((grams / one) * 2) / 2)) };
    }
    const food = byName(foods, p.match) ?? searchFoods(foods, p.name, 1, prefer)[0];
    if (food) {
      const item = p.count && food.units?.length ? itemFor(food, { qty: p.count }) : itemFor(food, { qty: grams, measure: 'г' });
      return { text, unsure, item: p.cooking !== 'unknown' ? { ...item, cooking: p.cooking } : item };
    }
    return { text, unsure, estimate: true, item: { name: p.name, grams,
      manual: { kcal: Math.round(p.kcal), protein: r1(p.protein), fat: r1(p.fat), carbs: r1(p.carbs) } } };
  });
}
