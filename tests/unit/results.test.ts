import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { untilVisit, weekPhrase, weekResults } from '../../src/domain/results';
import type { DayEntry, MealItem, Plan } from '../../src/domain/types';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const T = '2026-11-17';
const day = (n: number) => `2026-11-${String(17 - n).padStart(2, '0')}`;
const plan = (over: Partial<Plan> = {}): Plan => ({ constraints: [], targets: {}, modes: [], prescriptions: [], ...over } as Plan);
const met = { id: 'met', kind: 'medication' as const, title: 'Метформін', schedule: { times: ['08:00', '20:00'] }, source: 'x', since: '2026-01-01' };
const tick = (d: string, time: string): DayEntry => ({ id: `t${d}${time}`, at: `${d}T${time}:05:00+02:00`.replace(':05:00', ':05'), kind: 'med', status: 'done', title: 'Метформін', checkKey: `med:met:${time}`, prescriptionId: 'met' });
const meal = (d: string, items: MealItem[]): DayEntry => ({ id: `m${d}${items[0]!.name}`, at: `${d}T13:00:00+02:00`, kind: 'meal', status: 'done', title: 'Обід', items });
const fried: MealItem = { foodId: 'egg-boiled', name: 'Яйце смажене', grams: 100, cooking: 'fried' };
const boiled: MealItem = { foodId: 'egg-boiled', name: 'Яйце варене', grams: 100 };
const gallbladder = { id: 'g', tag: 'gallbladder' as const, title: 'Жовчний', reason: '', source: 'x', active: true };

describe('the week on «Результати» (D164)', () => {
  it('counts due doses of the week, today only those already past', () => {
    const entries = [0, 1, 2, 3, 4, 5, 6].flatMap((n) => [tick(day(n), '08:00'), ...(n > 1 ? [tick(day(n), '20:00')] : [])]);
    // at noon: 6 past days of two doses (one evening missed) and today's 08:00 — today's 20:00 is not due yet
    const r = weekResults({ plan: plan({ prescriptions: [met] }), entries, workouts: [], foods, today: T, now: new Date(`${T}T12:00:00`) });
    expect(r.meds).toEqual({ done: 12, total: 13 });
  });

  it('a day is «за планом» when its recorded food has no remark; days without food are not', () => {
    const entries = [meal(day(1), [boiled]), meal(day(2), [boiled]), meal(day(3), [fried])];
    const r = weekResults({ plan: plan({ constraints: [gallbladder] }), entries, workouts: [], foods, today: T });
    expect(r.food).toEqual({ onPlan: 2, days: 7 });
  });

  it('no food limits in the plan — no food number; no medicine — no medicine number', () => {
    const r = weekResults({ plan: plan(), entries: [meal(day(1), [fried])], workouts: [], foods, today: T });
    expect(r.food).toBeUndefined();
    expect(r.meds).toBeUndefined();
    expect(r.recorded).toBe(1);
  });

  it('weight change only with a goal weight and two weighings this week', () => {
    const weights = [{ date: day(6), kg: 92.4 }, { date: day(0), kg: 91.8 }];
    expect(weekResults({ plan: plan({ targets: { weightGoalKg: 85 } }), entries: [], workouts: [], foods, weights, today: T }).weight).toEqual({ delta: -0.6 });
    expect(weekResults({ plan: plan(), entries: [], workouts: [], foods, weights, today: T }).weight).toBeUndefined();
  });

  it('one phrase: «Ліки — 26 з 28, їжа за планом 5 днів з 7»', () => {
    expect(weekPhrase({ from: day(6), to: T, recorded: 7, meds: { done: 26, total: 28 }, food: { onPlan: 5, days: 7 } })).toBe('Ліки — 26 з 28, їжа за планом 5 днів з 7');
    expect(weekPhrase({ from: day(6), to: T, recorded: 7, food: { onPlan: 1, days: 7 } })).toBe('їжа за планом 1 день з 7');
    expect(weekPhrase({ from: day(6), to: T, recorded: 3 })).toBe('Записи є 3 дні з 7');
    expect(weekPhrase({ from: day(6), to: T, recorded: 0 })).toBe('Цього тижня записів ще немає');
  });

  it('time to the visit in words; nothing once it is past', () => {
    expect(untilVisit('2027-01-17', T)).toBe('2 місяці');
    expect(untilVisit('2026-12-08', T)).toBe('3 тижні');
    expect(untilVisit('2026-11-22', T)).toBe('5 днів');
    expect(untilVisit('2026-11-18', T)).toBe('завтра');
    expect(untilVisit(T, T)).toBe('сьогодні');
    expect(untilVisit('2026-11-10', T)).toBeUndefined();
    expect(untilVisit(undefined, T)).toBeUndefined();
  });
});
