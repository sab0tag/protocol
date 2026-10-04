import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { fromPhoto, type PhotoItem } from '../../src/domain/photo';
import { dishItem } from '../../src/domain/recipes';

const item = (p: Partial<PhotoItem>): PhotoItem => ({ name: '', match: null, grams: 100, count: null, cooking: 'unknown',
  kcal: 0, protein: 0, fat: 0, carbs: 0, confidence: 'high', ...p });

describe('photo → «Розпізнано»', () => {
  it('a food from the base by its exact name, in pieces when counted', () => {
    const [eggs] = fromPhoto({ items: [item({ name: 'яйця варені', match: 'Яйце куряче', grams: 100, count: 2, cooking: 'boiled' })], note: null },
      FOODS, RECIPES, dishItem);
    expect(eggs!.item).toMatchObject({ foodId: 'egg', grams: 100, unit: { name: 'шт', qty: 2 }, cooking: 'boiled' });
    expect(eggs!.estimate).toBeUndefined();
  });

  it('grams when not counted; found by words when the model gave no match', () => {
    const [g] = fromPhoto({ items: [item({ name: 'гречка варена', grams: 182 })], note: null }, FOODS, RECIPES, dishItem);
    expect(g!.item).toMatchObject({ foodId: 'buckwheat-boiled', grams: 182 });
    expect(g!.item!.unit).toBeUndefined();
  });

  it('a dish from the list stays one line, portions by weight', () => {
    const one = dishItem(RECIPES.find((r) => r.id === 'dish-salad-veg')!, 1).grams;
    const [s] = fromPhoto({ items: [item({ name: 'салат', match: 'Салат овочевий з олією', grams: one * 1.4 })], note: null }, FOODS, RECIPES, dishItem);
    expect(s!.item).toMatchObject({ recipe: { id: 'dish-salad-veg', portions: 1.5 } });
  });

  it('not in the base → a free line with the estimate; unsure is flagged; zero grams dropped', () => {
    const r = fromPhoto({ items: [
      item({ name: 'сирники', grams: 150, kcal: 330.4, protein: 21.26, fat: 15, carbs: 27, confidence: 'low' }),
      item({ name: 'щось', grams: 0 }),
    ], note: null }, FOODS, RECIPES, dishItem);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ estimate: true, unsure: true,
      item: { name: 'сирники', grams: 150, manual: { kcal: 330, protein: 21.3, fat: 15, carbs: 27 } } });
  });
});
