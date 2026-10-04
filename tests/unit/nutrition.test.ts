import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { examplePlan } from '../../src/data/seed.example';
import { activeMode, dayTotals, effectiveTargets, itemNutrients, mealNutrients, normalize } from '../../src/domain/nutrition';
import type { DayEntry } from '../../src/domain/types';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const food = (id: string) => foods.get(id)!;

describe('nutrition', () => {
  it('scales per-100 g values by grams', () => {
    const n = itemNutrients({ foodId: 'buckwheat', name: 'Гречка', grams: 70 }, food('buckwheat'));
    expect(n.kcal).toBeCloseTo(240.1);
    expect(n.carbs).toBeCloseTo(43.4);
    expect(n.calciumMg).toBeCloseTo(14);
  });

  it('takes a free line as entered for the whole portion', () => {
    const n = itemNutrients({ name: 'Суп', grams: 300, manual: { kcal: 150, protein: 8, fat: 5, carbs: 18 } }, undefined);
    expect(n).toEqual({ kcal: 150, protein: 8, fat: 5, carbs: 18, calciumMg: 0 });
  });

  it('sums a meal', () => {
    const n = mealNutrients([
      { foodId: 'chicken-breast', name: 'Філе', grams: 150 },
      { foodId: 'broccoli', name: 'Броколі', grams: 200 },
      { foodId: 'parmesan', name: 'Пармезан', grams: 25 },
    ], foods);
    expect(n.protein).toBeCloseTo(34.5 + 5.6 + 8.25);
    expect(n.calciumMg).toBeCloseTo(7.5 + 94 + 295);
  });

  it('counts only done entries, water separately', () => {
    const entries: DayEntry[] = [
      { id: '1', at: '2026-10-04T08:00:00+03:00', kind: 'meal', status: 'done', title: 'Сніданок',
        items: [{ foodId: 'oats', name: 'Вівсянка', grams: 50 }] },
      { id: '2', at: '2026-10-04T13:00:00+03:00', kind: 'meal', status: 'planned', title: 'Обід',
        items: [{ foodId: 'buckwheat', name: 'Гречка', grams: 100 }] },
      { id: '3', at: '2026-10-04T09:00:00+03:00', kind: 'water', status: 'done', title: 'Вода', waterMl: 250 },
      { id: '4', at: '2026-10-04T10:00:00+03:00', kind: 'water', status: 'skipped', title: 'Вода', waterMl: 250 },
    ];
    const t = dayTotals(entries, foods);
    expect(t.carbs).toBeCloseTo(30);
    expect(t.waterMl).toBe(250);
  });

  it('a mode overrides targets on its days only and says which day it is', () => {
    const plan = examplePlan(new Date('2026-10-04T12:00:00'));
    expect(effectiveTargets(plan, '2026-10-04').carbsG).toEqual({ max: 190 });
    expect(effectiveTargets(plan, '2026-10-08').carbsG).toEqual({ min: 150 });
    expect(activeMode(plan, '2026-10-08')).toMatchObject({ day: 2, of: 3 });
    expect(activeMode(plan, '2026-10-10')).toBeUndefined();
  });

  it('normalizes names for search and rules', () => {
    expect(normalize("  Пюре   м'ясне ")).toBe('пюре мясне');
  });
});
