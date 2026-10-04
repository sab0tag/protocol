// Built-in dishes (D27): ingredients for one portion, approximate. Ids are stable; user dishes get random ids.
import type { MealItem, Recipe } from '../domain/types';
import { FOODS } from './foods';

const byId = new Map(FOODS.map((f) => [f.id, f]));
/** An ingredient: grams, or a count of the food's measure («шт», «ч. л.»). */
function c(foodId: string, amount: number, unit?: string): MealItem {
  const food = byId.get(foodId);
  if (!food) throw new Error(`recipes.ts: no food ${foodId}`);
  const u = unit ? food.units?.find((x) => x.name === unit) : undefined;
  if (unit && !u) throw new Error(`recipes.ts: ${foodId} has no unit ${unit}`);
  return u ? { foodId, name: food.name, grams: Math.round(amount * u.grams), unit: { name: u.name, qty: amount, grams: u.grams } }
    : { foodId, name: food.name, grams: amount };
}

const r = (id: string, name: string, aliases: string[], items: MealItem[]): Recipe => ({ id, name, aliases, items, builtIn: true });

export const RECIPES: Recipe[] = [
  r('dish-salad-veg', 'Салат овочевий з олією', ['салат', 'овочевий салат', 'салат з огірків і помідорів'], [
    c('cucumber', 1, 'шт'), c('tomato', 1, 'шт'), c('bell-pepper', 60), c('onion', 20), c('herbs', 1, 'ст. л.'),
    c('olive-oil', 2, 'ч. л.'), c('balsamic', 1, 'ч. л.'), c('salt', 1, 'дрібка'),
  ]),
  r('dish-salad-cabbage', 'Салат з капусти й моркви', ['салат з капусти', 'вітамінний салат', 'салат'], [
    c('cabbage', 150), c('carrot', 40), c('sunflower-oil', 2, 'ч. л.'), c('lemon-juice', 1, 'ч. л.'), c('salt', 1, 'дрібка'),
  ]),
  r('dish-vinegret', 'Вінегрет', ['салат'], [
    c('beet', 80), c('potato-boiled', 60), c('carrot', 40), c('pickles', 40), c('sauerkraut', 30), c('onion', 15),
    c('sunflower-oil', 2, 'ч. л.'),
  ]),
  r('dish-omelet', 'Омлет з 2 яєць', ['омлет', 'яєчня'], [
    c('egg', 2, 'шт'), c('milk', 30), c('butter', 1, 'ч. л.'), c('salt', 1, 'дрібка'),
  ]),
  r('dish-buckwheat-chicken', 'Гречка з куркою', ['гречка з куркою', 'гречка з філе'], [
    c('buckwheat-boiled', 200), c('chicken-breast-cooked', 120),
  ]),
];
