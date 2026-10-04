import { describe, expect, it } from 'vitest';
import { ensureSeeded, ProtocolDB } from '../../src/data/db';
import { FOODS } from '../../src/data/foods';
import { amountText, itemFor, parseQuery, searchFoods } from '../../src/domain/foodSearch';
import { itemNutrients } from '../../src/domain/nutrition';

const byId = new Map(FOODS.map((f) => [f.id, f]));
const find = (q: string) => { const p = parseQuery(q); const food = searchFoods(FOODS, p.text)[0]; return { p, food, item: food && itemFor(food, p) }; };

describe('food search and household measures (D26)', () => {
  it('«2 варених яйця» → boiled egg, 2 шт ≈ 100 г, nutrients counted', () => {
    const { p, food, item } = find('2 варених яйця');
    expect(p).toEqual({ text: 'варених яйця', qty: 2 });
    expect(food?.id).toBe('egg-boiled');
    expect(item).toEqual({ foodId: 'egg-boiled', name: 'Яйце варене', grams: 100, unit: { name: 'шт', qty: 2, grams: 50 } });
    expect(itemNutrients(item!, food).protein).toBeCloseTo(12.6);
    expect(amountText(item!)).toBe('2 шт');
  });

  it('«відварне яйце» and «яйця» find eggs too', () => {
    expect(find('відварне яйце').food?.id).toBe('egg-boiled');
    expect(searchFoods(FOODS, 'яйця').map((f) => f.id)).toEqual(expect.arrayContaining(['egg', 'egg-boiled']));
  });

  it('grams, glasses, spoons, slices', () => {
    expect(find('150 г гречка варена').item).toMatchObject({ foodId: 'buckwheat-boiled', grams: 150 });
    expect(find('150 гречка варена').item).toMatchObject({ grams: 150 });                       // a big number = grams
    expect(find('склянка кефіру').item).toMatchObject({ grams: 250, unit: { name: 'склянка', qty: 1 } });
    expect(find('2 ст. л. сметани').item).toMatchObject({ foodId: 'sour-cream', grams: 50 });
    expect(find('ложка меду').item).toMatchObject({ foodId: 'honey', grams: 35 });
    expect(find('2 скибки житнього хліба').item).toMatchObject({ foodId: 'bread-rye', grams: 60 });
    expect(find('пів авокадо').item).toMatchObject({ foodId: 'avocado', grams: 70 });
    expect(find('1,5 банана').item).toMatchObject({ grams: 180, unit: { qty: 1.5 } });
  });

  it('nothing said about the amount: one household measure, or 100 g when the food has none', () => {
    expect(itemFor(byId.get('apple')!, {})).toMatchObject({ grams: 180, unit: { name: 'шт', qty: 1 } });
    expect(itemFor({ ...byId.get('apple')!, units: undefined }, {})).toEqual({ foodId: 'apple', name: 'Яблуко', grams: 100 });
  });

  it('the base is refreshed for an existing device that has the old 15 foods', async () => {
    const db = new ProtocolDB('foods-upgrade');
    await db.foods.bulkPut(FOODS.slice(0, 15).map((f) => ({ ...f, units: undefined })));
    await ensureSeeded(db);
    expect(await db.foods.count()).toBe(FOODS.length);
    expect((await db.foods.get('egg'))?.units?.[0]).toEqual({ name: 'шт', grams: 50 });
    db.close();
  });

  it('every food is sane: ids unique, nutrients plausible, measures positive', () => {
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length);
    for (const f of FOODS) {
      const { kcal, protein, fat, carbs } = f.per100g;
      expect(protein + fat + carbs, f.name).toBeLessThanOrEqual(101);
      expect(Math.abs(kcal - (4 * protein + 9 * fat + 4 * carbs)), f.name).toBeLessThan(Math.max(30, kcal * 0.2));
      for (const u of f.units ?? []) expect(u.grams, `${f.name} ${u.name}`).toBeGreaterThan(0);
    }
  });
});

describe('measure words', () => {
  it('agree with the number', () => {
    const it = (name: string, qty: number) => amountText({ name: 'x', grams: 1, unit: { name, qty, grams: 1 } });
    expect([it('скибка', 1), it('скибка', 2), it('скибка', 5), it('скибка', 1.5), it('шт', 2)]).toEqual(['1 скибка', '2 скибки', '5 скибок', '1,5 скибки', '2 шт']);
  });
});
