import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { likeYesterday, nextAlternative } from '../../src/domain/menu';
import { dishItem } from '../../src/domain/recipes';
import { shoppingList, shoppingText } from '../../src/domain/shopping';
import type { DayEntry } from '../../src/domain/types';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const e = (id: string, at: string, items: DayEntry['items'], status: DayEntry['status'] = 'planned'): DayEntry => ({ id, at, kind: 'meal', status, title: 'Обід', items });

describe('shopping list', () => {
  it('sums planned meals of the days, cooked → dry, eggs in pieces, dishes opened up, seasonings last', () => {
    const entries = [
      e('a', '2026-10-08T13:00:00+03:00', [{ foodId: 'buckwheat-boiled', name: 'Гречка варена', grams: 300 }, { foodId: 'egg-boiled', name: 'Яйце варене', grams: 100 }]),
      e('b', '2026-10-09T13:00:00+03:00', [{ foodId: 'buckwheat-boiled', name: 'Гречка варена', grams: 300 }, dishItem(RECIPES.find((r) => r.id === 'dish-salad-veg')!, 1)]),
      e('c', '2026-10-09T08:00:00+03:00', [{ foodId: 'egg', name: 'Яйце куряче', grams: 120 }]),
      e('done', '2026-10-08T08:00:00+03:00', [{ foodId: 'apple', name: 'Яблуко', grams: 180 }], 'done'),
      e('late', '2026-10-12T08:00:00+03:00', [{ foodId: 'apple', name: 'Яблуко', grams: 180 }]),
    ];
    const rows = shoppingList(entries, foods, '2026-10-08', '2026-10-10');
    const by = Object.fromEntries(rows.map((r) => [r.name, r.amount]));
    expect(by['Гречка (суха)']).toBe('230 г'); // 600 × 0.37 = 222 → up to 10 g
    expect(by['Яйце куряче']).toBe('5 шт'); // 100 + 120 g / 50
    expect(by['Огірок']).toBeDefined();
    expect(by['Яблуко']).toBeUndefined(); // eaten already / out of range
    expect(rows.at(-1)!.pantry).toBe(true);
    expect(shoppingText(rows, new Set(['Огірок']))).not.toContain('Огірок');
  });
});

describe('editing a draft', () => {
  it('«Як учора» takes yesterday\'s meals with their pieces', () => {
    const r = likeYesterday([e('y', '2026-10-07T08:00:00+03:00', [{ foodId: 'egg-boiled', name: 'Яйце варене', grams: 100, unit: { name: 'шт', qty: 2, grams: 50 } }]),
      e('s', '2026-10-07T13:00:00+03:00', [{ name: 'x', grams: 1 }], 'skipped')], '2026-10-08')!;
    expect(r.meals).toMatchObject([{ title: 'Обід', time: '08:00', items: [{ name: 'Яйце варене', grams: 100, count: 2, line: { foodId: 'egg-boiled' } }] }]);
    expect(likeYesterday([], '2026-10-08')).toBeNull();
  });

  it('↻ the next food of the same kind with about the same calories; vegetables keep grams; dishes go round', () => {
    const rice = nextAlternative({ foodId: 'buckwheat-boiled', name: 'Гречка варена', grams: 200 }, foods, RECIPES, dishItem)!;
    expect(rice.foodId).not.toBe('buckwheat-boiled');
    expect(foods.get(rice.foodId!)!.tags[0]).toBe('grain');
    expect(rice.name).not.toMatch(/сух/); // cooked for cooked
    const kcal = (g: number, id: string) => (foods.get(id)!.per100g.kcal * g) / 100;
    expect(Math.abs(kcal(rice.grams, rice.foodId!) - kcal(200, 'buckwheat-boiled'))).toBeLessThan(15);
    const veg = nextAlternative({ foodId: 'cucumber', name: 'Огірок', grams: 120 }, foods, RECIPES, dishItem)!;
    expect(veg.grams).toBe(120);
    const dish = nextAlternative(dishItem(RECIPES[0]!, 2), foods, RECIPES, dishItem)!;
    expect(dish.recipe).toMatchObject({ portions: 2 });
    expect(dish.recipe!.id).not.toBe(RECIPES[0]!.id);
  });
});
