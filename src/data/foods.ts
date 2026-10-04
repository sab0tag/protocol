// Built-in food base (SPEC.md §9.1): approximate per-100 g values — check against the package.
import type { Food } from '../domain/types';

const f = (id: string, name: string, kcal: number, protein: number, fat: number, carbs: number, calciumMg: number,
  tags: string[]): Food => ({ id, name, per100g: { kcal, protein, fat, carbs, calciumMg }, tags });

export const FOODS: Food[] = [
  f('oats', 'Вівсяні пластівці (сухі)', 370, 13, 7, 60, 50, ['grain', 'slow-carb']),
  f('buckwheat', 'Гречка (суха)', 343, 13, 3.4, 62, 20, ['grain', 'slow-carb']),
  f('brown-rice', 'Рис бурий (сухий)', 360, 7.5, 2.7, 76, 20, ['grain', 'slow-carb']),
  f('quinoa', 'Кіноа (суха)', 368, 14, 6, 64, 47, ['grain', 'slow-carb']),
  f('chicken-breast', 'Куряче філе (сире)', 113, 23, 2, 0, 5, ['meat']),
  f('chicken-thigh', 'Філе стегна без шкіри (сире)', 125, 19, 5, 0, 10, ['meat']),
  f('egg', 'Яйце куряче', 143, 12.6, 9.5, 0.7, 56, ['egg']),
  f('kefir', 'Кефір 2,5 %', 50, 2.9, 2.5, 4, 120, ['dairy-low-lactose', 'calcium']),
  f('parmesan', 'Пармезан / Grana Padano', 400, 33, 28, 0, 1180, ['cheese-aged', 'calcium']),
  f('sardines', 'Сардини з кістками (конс.)', 210, 25, 11, 0, 380, ['fish', 'calcium']),
  f('broccoli', 'Броколі', 34, 2.8, 0.4, 7, 47, ['veg', 'low-oxalate']),
  f('cucumber', 'Огірок', 15, 0.7, 0.1, 3, 16, ['veg', 'low-oxalate']),
  f('tomato', 'Помідор', 18, 0.9, 0.2, 3.9, 10, ['veg']),
  f('apple', 'Яблуко', 52, 0.3, 0.2, 14, 6, ['fruit']),
  f('olive-oil', 'Олія оливкова', 884, 0, 100, 0, 0, ['fat']),
];
