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
  // ---- D45: everyday Ukrainian dishes, one portion (approximate)
  r('dish-borscht', 'Борщ', ['борщ український', 'борщик'], [
    c('beet', 80), c('cabbage', 60), c('potato-boiled', 60), c('carrot', 30), c('onion', 20), c('tomato-paste', 10),
    c('beef-stewed', 50), c('sunflower-oil', 1, 'ч. л.'), c('broth-chicken', 150), c('salt', 1, 'дрібка'),
  ]),
  r('dish-chicken-soup', 'Курячий суп з локшиною', ['курячий суп', 'суп з куркою'], [
    c('broth-chicken', 250), c('chicken-breast-cooked', 60), c('potato-boiled', 50), c('carrot', 25), c('pasta-boiled', 40), c('herbs', 1, 'ст. л.'),
  ]),
  r('dish-plov', 'Плов з куркою', ['плов'], [
    c('white-rice', 70), c('chicken-thigh-baked', 100), c('carrot', 50), c('onion', 30), c('sunflower-oil', 2, 'ч. л.'), c('salt', 1, 'дрібка'),
  ]),
  r('dish-ragout', 'Овочеве рагу', ['рагу', 'тушковані овочі'], [
    c('zucchini', 120), c('eggplant-baked', 80), c('bell-pepper', 60), c('tomato', 1, 'шт'), c('onion', 30), c('carrot', 30), c('olive-oil', 2, 'ч. л.'),
  ]),
  r('dish-syrnyky', 'Сирники зі сметаною', ['сирники'], [
    c('syrnyky', 3, 'шт'), c('sour-cream', 1, 'ст. л.'),
  ]),
  r('dish-curd-bake', 'Сирна запіканка', ['запіканка'], [
    c('cottage-cheese', 150), c('egg', 1, 'шт'), c('sour-cream', 1, 'ст. л.'), c('oats', 2, 'ст. л.'), c('raisins', 1, 'ст. л.'),
  ]),
  r('dish-oats-berries', 'Вівсянка з ягодами', ['вівсянка з ягодами', 'каша з ягодами'], [
    c('oatmeal-water', 1, 'порція'), c('blueberry', 1, 'жменя'), c('walnut', 10),
  ]),
  r('dish-buckwheat-mushrooms', 'Гречка з грибами', ['гречка з печерицями'], [
    c('buckwheat-boiled', 200), c('mushrooms', 100), c('onion', 20), c('sunflower-oil', 1, 'ч. л.'),
  ]),
  r('dish-omelet-veg', 'Омлет з овочами', ['омлет з помідорами'], [
    c('egg', 2, 'шт'), c('tomato', 60), c('bell-pepper', 50), c('herbs', 1, 'ст. л.'), c('olive-oil', 1, 'ч. л.'), c('salt', 1, 'дрібка'),
  ]),
  r('dish-greek-salad', 'Грецький салат', ['салат грецький'], [
    c('cucumber', 1, 'шт'), c('tomato', 1, 'шт'), c('bell-pepper', 50), c('onion', 15), c('feta', 40), c('olives', 4, 'шт'), c('olive-oil', 2, 'ч. л.'),
  ]),
  r('dish-chicken-veg-airfryer', 'Курка з овочами в аерогрилі', ['курка з овочами', 'філе з овочами'], [
    { ...c('chicken-breast', 150), cooking: 'airfryer' }, { ...c('zucchini', 120), cooking: 'airfryer' }, { ...c('bell-pepper', 80), cooking: 'airfryer' },
    c('olive-oil', 1, 'ч. л.'), c('salt', 1, 'дрібка'),
  ]),
  r('dish-fish-rice', 'Риба з бурим рисом і броколі', ['риба з рисом', 'хек з рисом'], [
    c('hake-baked', 150), c('brown-rice-boiled', 150), c('broccoli', 120), c('lemon-juice', 1, 'ч. л.'),
  ]),
  r('dish-cabbage-meat', 'Тушкована капуста з м’ясом', ['капуста з м’ясом', 'бігос'], [
    c('cabbage-stewed', 200), c('pork-baked', 80), c('carrot', 30),
  ]),
  r('dish-yogurt-bowl', 'Йогурт з гранолою і ягодами', ['йогурт з гранолою'], [
    c('greek-yogurt', 1, 'баночка'), c('granola', 30), c('raspberry', 1, 'жменя'),
  ]),
];
