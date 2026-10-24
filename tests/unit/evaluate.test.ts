// R03: one evaluation for every way in — the real day built from the entries, «recorded» against «proposed», a swap only when
// the meal with it passes as a whole.
import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { emptyPlan } from '../../src/data/seed.example';
import { passing } from '../../src/domain/assistant';
import { dietOf, type DietRule } from '../../src/domain/diets';
import { evaluate, passes, safeSwaps } from '../../src/domain/evaluate';
import { applySwaps } from '../../src/domain/rules';
import type { Constraint, DayEntry, MealItem, Plan } from '../../src/domain/types';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const c = (tag: Constraint['tag'], o: Partial<Constraint> = {}): Constraint => ({ id: tag, tag, title: tag, reason: '', source: '', active: true, ...o });
const plan = (...cs: Constraint[]): Plan => ({ ...emptyPlan(), constraints: cs });
const meal = (id: string, at: string, items: MealItem[], status: DayEntry['status'] = 'done'): DayEntry => ({ id, at, kind: 'meal', status, title: 'Обід', items });
const sausage = (g: number): MealItem => ({ name: 'Ковбаса варена', grams: g });
const D = '2026-10-24';

describe('one evaluation for every way in (R03)', () => {
  it('what was eaten is judged against what else was eaten — a meal only planned is not counted as eaten', () => {
    const p = plan(c('sodium'));
    const planned = [meal('p', `${D}T19:00:00`, [sausage(80)], 'planned')];
    const salt = (intent: 'recorded' | 'proposed') => evaluate({ plan: p, date: D, intent, foods, entries: planned, meal: [sausage(40)] })
      .checks.flatMap((x) => x.hits).map((h) => h.message);
    expect(salt('recorded')).toEqual([]); // 40 g eaten — the planned 80 g is not eaten yet
    expect(salt('proposed')).toEqual(['Багато солі за день']); // a forecast with the evening's plan: 120 g
    // the candidate being edited is never counted twice
    const self = [meal('m', `${D}T13:00:00`, [sausage(60)])];
    expect(evaluate({ plan: p, date: D, intent: 'recorded', foods, entries: self, exclude: 'm', meal: [sausage(60)] }).checks[0]!.hits).toEqual([]);
  });

  it('a rule that looks back sees the week; a temporary mode works at every way in', () => {
    const p: Plan = { ...plan(c('iron')), modes: [] };
    const liver: MealItem = { name: 'Печінка куряча', grams: 100 };
    const lastWeek = [meal('l', '2026-10-20T13:00:00', [liver])];
    expect(passes({ plan: p, date: D, foods, entries: [] }, liver)).toBe(true);
    expect(passes({ plan: p, date: D, foods, entries: lastWeek }, liver)).toBe(false);
    // the assistant's foods and the evening tips — the same real day (F03: they were checked against an empty one)
    expect(passing([liver], p, D, foods, lastWeek).dropped).toEqual(['Печінка куряча']);
  });

  it('a swap that breaks another limit is not offered — its hit stays, «no fitting swap»; a fitting swap is', () => {
    const shd = dietOf('ЩД')!, was = shd.rules;
    const noKefir: DietRule = { id: 'no-kefir', version: 1, kind: 'exclude', title: 'без кефіру', match: { words: ['кефір'] }, checkedBy: 'Тест' };
    try {
      shd.rules = [noKefir];
      const milk: MealItem = { foodId: 'milk', name: 'Молоко 2,5 %', grams: 200 };
      const ctx = { plan: plan(c('lactose'), c('diet', { diet: 'ЩД' })), date: D, foods, entries: [] };
      const raw = evaluate({ ...ctx, intent: 'proposed', meal: [milk] }).checks;
      expect(applySwaps(raw, foods)[0]!.name).toBe('Кефір 2,5 %'); // the lactose rule alone would swap to kefir
      const safe = safeSwaps({ ...ctx, intent: 'proposed' }, raw);
      expect(safe.swapped[0]!.name).toBe('Молоко 2,5 %'); // kefir breaks the diet — not offered
      expect(safe.checks[0]!.hits.find((h) => h.reason === 'lactose')).toMatchObject({ noSwap: true });
      shd.rules = [];
      const fine = safeSwaps({ ...ctx, intent: 'proposed' }, evaluate({ ...ctx, intent: 'proposed', meal: [milk] }).checks);
      expect(fine.swapped[0]!.name).toBe('Кефір 2,5 %');
    } finally { shd.rules = was; }
  });

  it('a dish keeps the limits of what is inside it', () => {
    const dish: MealItem = { name: 'Бутерброд', grams: 150, recipe: { id: 'x', portions: 1 }, components: [{ name: 'Хліб', grams: 50 }, sausage(150)] };
    expect(evaluate({ plan: plan(c('sodium')), date: D, intent: 'recorded', foods, entries: [], meal: [dish] }).checks[0]!.hits.map((h) => h.reason)).toEqual(['sodium']);
  });
});
