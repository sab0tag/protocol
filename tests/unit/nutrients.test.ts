// D188 («Очередь агента», задача 10): salt, fibre, sugars, saturated fat — a source per row, unknown never 0, sums «не менше»,
// salt by the plan's own words, calories checked against the macros.
import { describe, expect, it } from 'vitest';
import products from '../../src/data/harch/products.json';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { harchDishes } from '../../src/data/harchDishes';
import { BASE_EXTRA, HARCH_EXTRA, NO_SOURCE } from '../../src/data/nutrientSources';
import { fieldsToNutrients, nutrientsToFields, EMPTY_FIELDS } from '../../src/components/NutrientFields';
import { dishItem, detachFood, regram } from '../../src/domain/recipes';
import { kcalOff, lineNutrients, mealNutrients, saltG, saltLimit, saltLine } from '../../src/domain/nutrition';
import { emptyPlan } from '../../src/data/seed.example';
import { t } from '../../src/i18n/uk';

const foods = new Map(FOODS.map((f) => [f.id, f]));

describe('the table (nutrientSources.ts)', () => {
  it('every base food is either sourced or listed as unknown — and every row names its source', () => {
    for (const f of FOODS) expect(f.id in BASE_EXTRA || NO_SOURCE.includes(f.id), f.id).toBe(true);
    for (const [id, row] of Object.entries(BASE_EXTRA)) {
      expect(foods.has(id), id).toBe(true);
      expect(row.src, id).toMatch(/^FDC \d+/);
    }
    for (const name of Object.keys(HARCH_EXTRA)) expect((products as { name: string }[]).some((p) => p.name === name), name).toBe(true);
  });
  it('the numbers reach the base: salt is sodium 38 758 mg; a food without a source knows none of the four', () => {
    expect(foods.get('salt')!.per100g.sodiumMg).toBe(38758);
    expect(foods.get('bread-rye')!.per100g).toMatchObject({ sodiumMg: 603, fiberG: 5.8 });
    const v = foods.get('vareniki-potato')!.per100g;
    expect([v.sodiumMg, v.fiberG, v.sugarsG, v.satFatG]).toEqual([undefined, undefined, undefined, undefined]);
  });
  it('our curd is not the salted American cottage cheese; salted salo has no sodium from an unsalted source', () => {
    expect(foods.get('cottage-cheese')!.per100g.sodiumMg).toBeLessThan(50);
    expect(foods.get('salo')!.per100g.sodiumMg).toBeUndefined();
    expect(foods.get('salo')!.per100g.satFatG).toBeGreaterThan(20);
  });
  it('sugars never above the carbohydrates', () => {
    for (const f of FOODS) if (f.per100g.sugarsG !== undefined) expect(f.per100g.sugarsG, f.id).toBeLessThanOrEqual(f.per100g.carbs + 0.05);
  });
});

describe('sums: unknown is not zero', () => {
  it('a dish gets the four from its ingredients — the salt in the recipe counts as an ingredient', () => {
    const salad = RECIPES.find((r) => r.id === 'dish-salad-veg')!;
    const n = lineNutrients(dishItem(salad, 1), foods);
    expect(n.sodiumMg).toBeGreaterThan(100); // a pinch of salt is there
    expect(n.partial.sodiumMg).toBeUndefined();
  });
  it('a meal with a food the table does not know: the sum is «не менше»', () => {
    const n = mealNutrients([{ foodId: 'bread-rye', name: 'Хліб', grams: 50 }, { foodId: 'vareniki-potato', name: 'Вареники', grams: 200 }], foods);
    expect(Math.round(n.sodiumMg)).toBe(302);
    expect(n.partial.sodiumMg).toBe(true);
    expect(saltLine(n, { maxG: 5 }, t.nutrients.saltLine)).toBe('сіль не менше 0,8 г з 5');
  });
  it('a free line keeps the four through a new weight and when its own food is deleted', () => {
    const line = regram({ name: 'Суп', grams: 300, manual: { kcal: 150, protein: 8, fat: 5, carbs: 18, sodiumMg: 600 } }, 150);
    expect(line.manual!.sodiumMg).toBe(300);
    const own = { id: 'u-1', name: 'Мій хліб', custom: true, tags: [], per100g: { kcal: 250, protein: 8, fat: 3, carbs: 48, sodiumMg: 500 } };
    const { items } = detachFood([{ foodId: 'u-1', name: 'Мій хліб', grams: 40 }], own);
    expect(items[0]!.manual!.sodiumMg).toBe(200);
  });
  it('Харчоблок\'s own products (no base food) carry the table\'s numbers too', () => {
    const lines = harchDishes(foods).flatMap((d) => d.items).filter((i) => i.name === 'Пшоно' && i.manual);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]!.manual!.fiberG).toBeGreaterThan(0);
  });
});

describe('salt by the plan', () => {
  const plan = (title: string, reason = '') => ({ ...emptyPlan(), constraints: [{ id: 's', tag: 'sodium' as const, title, reason, source: 'лікар', active: true }] });
  it('the grams from the doctor\'s words; a rule without grams — salt still shown; no rule — nothing', () => {
    expect(saltLimit(plan('Сіль до 5 г на день'))).toEqual({ maxG: 5 });
    expect(saltLimit(plan('Обмежити сіль', 'не більше 6 г на добу'))).toEqual({ maxG: 6 });
    expect(saltLimit(plan('Сіль до 2,5 г'))).toEqual({ maxG: 2.5 });
    expect(saltLimit(plan('Менше солі'))).toEqual({});
    expect(saltLimit(emptyPlan())).toBeNull();
  });
  it('«сіль ~3,8 г з 5»: salt = sodium × 2.5', () => {
    expect(saltG(1520)).toBeCloseTo(3.8);
    expect(saltLine({ sodiumMg: 1520, partial: {} }, { maxG: 5 }, t.nutrients.saltLine)).toBe('сіль ~3,8 г з 5');
    expect(saltLine({ sodiumMg: 1520, partial: {} }, {}, t.nutrients.saltLine)).toBe('сіль ~3,8 г');
  });
});

describe('calories against the macros', () => {
  it('more than 20 % off — the macros\' number; close or tiny — nothing', () => {
    expect(kcalOff(100, 10, 5, 0)).toBeNull(); // 85 by the macros: 18 %
    expect(kcalOff(200, 10, 5, 0)).toBe(85);
    expect(kcalOff(5, 0.2, 0, 0.5)).toBeNull();
  });
  it('the form: an empty kcal is counted, salt in grams is kept as sodium, an empty extra stays unknown', () => {
    const n = fieldsToNutrients({ ...EMPTY_FIELDS, protein: '10', fat: '5', carbs: '20', saltG: '1,2' });
    expect(n).toEqual({ kcal: 165, protein: 10, fat: 5, carbs: 20, sodiumMg: 480 });
    expect(nutrientsToFields({ kcal: 100, protein: 1, fat: 1, carbs: 1, sodiumMg: 480 }).saltG).toBe('1.2');
  });
});
