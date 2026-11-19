// D189 («Очередь агента», задача 11): coverage first, averages of complete days only, no line through two weighings, the week's
// context, the place of an injection, the evening «what is not written».
import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { emptyPlan } from '../../src/data/seed.example';
import { dayComplete, foodAverage, recordCoverage } from '../../src/domain/coverage';
import { FOOD_COMPLETE } from '../../src/domain/habits';
import { injectable, lastSite, siteAsked } from '../../src/domain/injection';
import { dayContexts, isModuleEvent, type ModuleEvent } from '../../src/domain/modulePreferences';
import { weightTrend } from '../../src/domain/progress';
import { missingMeals, mealsLeftText } from '../../src/domain/reminders';
import { buildReport, reportText } from '../../src/domain/report';
import type { DayEntry, Prescription } from '../../src/domain/types';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const meal = (id: string, d: string, time: string, title: string, grams = 100): DayEntry =>
  ({ id, at: `${d}T${time}:00+03:00`, kind: 'meal', status: 'done', title, items: [{ foodId: 'buckwheat-boiled', name: 'Гречка варена', grams }] });
const fullDay = (d: string): DayEntry[] => [meal(`${d}b`, d, '08:00', 'Сніданок'), meal(`${d}l`, d, '13:00', 'Обід'), meal(`${d}d`, d, '19:00', 'Вечеря')];

describe('coverage and complete days', () => {
  it('a day is complete with three meals or «усе записано»; a single meal is partial', () => {
    expect(dayComplete(fullDay('2026-11-02'))).toBe(true);
    expect(dayComplete([meal('x', '2026-11-02', '13:00', 'Обід')])).toBe(false);
    expect(dayComplete([meal('x', '2026-11-02', '13:00', 'Обід'),
      { id: 'n', at: '2026-11-02T22:00:00+02:00', kind: 'note', status: 'done', title: '', checkKey: FOOD_COMPLETE }])).toBe(true);
  });
  it('coverage counts any recorded day, a weighing too; averages only from 4 complete days, partial ones named', () => {
    const entries = [...fullDay('2026-11-02'), ...fullDay('2026-11-03'), ...fullDay('2026-11-04'), meal('p', '2026-11-05', '13:00', 'Обід')];
    const cov = recordCoverage(entries, '2026-11-02', '2026-11-08', ['2026-11-07']);
    expect(cov).toMatchObject({ of: 7, recorded: 5, complete: ['2026-11-02', '2026-11-03', '2026-11-04'], partial: ['2026-11-05'] });
    expect(foodAverage(entries, foods, cov)).toBeUndefined(); // 3 complete days — no average
    const more = [...entries, ...fullDay('2026-11-06')];
    const avg = foodAverage(more, foods, recordCoverage(more, '2026-11-02', '2026-11-08'))!;
    expect(avg).toMatchObject({ days: 4, partial: 1, kcal: 330 }); // 3 × 100 g of buckwheat a day
  });
});

describe('the report: coverage first, «мало даних» under 4 days', () => {
  const now = new Date('2026-11-08T21:00:00');
  it('3 recorded days: the counts stay, no averages, no coincidences, no pace', () => {
    const entries = [...fullDay('2026-11-02'), ...fullDay('2026-11-03'), ...fullDay('2026-11-04')];
    const r = buildReport({ from: '2026-11-02', to: '2026-11-08', plan: emptyPlan(), entries, workouts: [], foods, now,
      wellbeing: [{ date: '2026-11-03', energy: 2, symptoms: [] }], weights: [{ date: '2026-11-02', kg: 90 }, { date: '2026-11-04', kg: 89 }] });
    expect(r.coverage).toEqual({ recorded: 3, of: 7, complete: 3, partial: 0 });
    expect(r.fewData).toBe(true);
    expect(r.avgEnergy).toBeUndefined();
    expect(r.weightPace).toBeUndefined();
    expect(r.foodAvg).toBeUndefined();
    const lines = reportText(r, (d) => d).split('\n');
    expect(lines.slice(1, 3)).toEqual(['Записано днів: 3 з 7', 'Мало даних — середніх і висновків не рахуємо.']);
  });
  it('enough days: the food average of complete days, the partial ones said apart', () => {
    const entries = [...fullDay('2026-11-02'), ...fullDay('2026-11-03'), ...fullDay('2026-11-04'), ...fullDay('2026-11-05'), meal('p', '2026-11-06', '13:00', 'Обід')];
    const r = buildReport({ from: '2026-11-02', to: '2026-11-08', plan: emptyPlan(), entries, workouts: [], wellbeing: [], weights: [], foods, now });
    expect(r.fewData).toBeUndefined();
    const text = reportText(r, (d) => d);
    expect(text).toContain('Середнє за 4 повних днів харчування: 330 ккал');
    expect(text).toContain('Неповних днів харчування: 1 — у середнє не входять.');
  });
});

describe('the week\'s context (a light day\'s reason)', () => {
  const ev = (id: string, at: string, date: string, reason: string) => ({ id, v: 1, at, kind: 'day-context', date, reason });
  it('a valid event; free text or an unknown reason is refused', () => {
    expect(isModuleEvent(ev('a1', '2026-11-03T08:00:00.000Z', '2026-11-03', 'ill'))).toBe(true);
    expect(isModuleEvent(ev('a2', '2026-11-03T08:00:00.000Z', '2026-11-03', 'грип'))).toBe(false);
    expect(isModuleEvent({ ...ev('a3', '2026-11-03T08:00:00.000Z', '2026-11-03', 'ill'), note: 'x' })).toBe(false);
  });
  it('the latest per date wins; «none» takes it back', () => {
    const events = [ev('a1', '2026-11-03T08:00:00.000Z', '2026-11-03', 'ill'), ev('a2', '2026-11-04T08:00:00.000Z', '2026-11-04', 'trip'),
      ev('a3', '2026-11-04T09:00:00.000Z', '2026-11-04', 'none')] as ModuleEvent[];
    expect([...dayContexts(events, '2026-11-01', '2026-11-07')]).toEqual([['2026-11-03', 'ill']]);
  });
});

describe('weight: no line through fewer than 4 weighings', () => {
  it('3 — the dots alone; 4 — the 7-day average beside each', () => {
    const three = [{ date: '2026-11-01', kg: 90 }, { date: '2026-11-04', kg: 89.5 }, { date: '2026-11-08', kg: 89 }];
    expect(weightTrend(three).every((x) => x.avg === undefined)).toBe(true);
    const four = [...three, { date: '2026-11-10', kg: 88.8 }];
    expect(weightTrend(four).at(-1)).toEqual({ date: '2026-11-10', kg: 88.8, avg: 89.1 }); // 11-04 … 11-10: 89.5, 89, 88.8
  });
});

describe('the place of an injection', () => {
  const insulin: Prescription = { id: 'p-ins', kind: 'medication', title: 'Лантус', dose: '12 ОД' } as Prescription;
  const glp: Prescription = { id: 'p-glp', kind: 'medication', title: 'Препарат', dose: '0,25 мг п/ш раз на тиждень' } as Prescription;
  const tablet: Prescription = { id: 'p-met', kind: 'medication', title: 'Метформін', dose: '500 мг' } as Prescription;
  it('only an injection of the plan: by the code, the name or the words «п/ш»', () => {
    expect(injectable(insulin)).toBe(true);
    expect(injectable(glp)).toBe(true);
    expect(injectable({ ...tablet, med: { name: 'Оземпік', atc: 'A10BJ06' } })).toBe(true);
    expect(injectable(tablet)).toBe(false);
  });
  it('asked for today\'s marked injection without a place; last time\'s place as the hint', () => {
    const dose = (id: string, at: string, site?: DayEntry['site']): DayEntry => ({ id, at, kind: 'med', status: 'done', title: 'Лантус', prescriptionId: 'p-ins', ...(site ? { site } : {}) });
    const before = dose('d1', '2026-11-07T21:00:00+02:00', { part: 'belly', side: 'left' });
    const today = dose('d2', '2026-11-08T21:00:00+02:00');
    expect(siteAsked([today], [insulin, tablet]).map((e) => e.id)).toEqual(['d2']);
    expect(lastSite([before, today], 'p-ins', 'd2')).toEqual({ part: 'belly', side: 'left' });
    expect(siteAsked([{ ...today, site: { part: 'thigh', side: 'right' } }], [insulin])).toEqual([]);
  });
});

describe('the evening food reminder', () => {
  it('names only breakfast, lunch, dinner not written; «усе записано» — nothing', () => {
    const day = [meal('b', '2026-11-08', '08:00', 'Сніданок')];
    expect(mealsLeftText(missingMeals(day, '2026-11-08'))).toBe('Не записано обід і вечерю — додати?');
    expect(missingMeals(fullDay('2026-11-08'), '2026-11-08')).toEqual([]);
  });
});
