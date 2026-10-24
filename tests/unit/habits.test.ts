import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { examplePlan } from '../../src/data/seed.example';
import { earlierMeals, frequentItems, mealsOf, weekSummary } from '../../src/domain/habits';
import { FOOD_COMPLETE } from '../../src/domain/habits';
import type { DayEntry, MealItem } from '../../src/domain/types';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const meal = (date: string, time: string, title: string, items: MealItem[], status: DayEntry['status'] = 'done'): DayEntry =>
  ({ id: `${date}${time}${title}`, at: `${date}T${time}:00+03:00`, kind: 'meal', status, title, items });
const oats: MealItem = { foodId: 'oatmeal-water', name: 'Вівсянка на воді', grams: 250, unit: { name: 'порція', qty: 1, grams: 250 } };
const kefir: MealItem = { foodId: 'kefir', name: 'Кефір 2,5 %', grams: 250, unit: { name: 'склянка', qty: 1, grams: 250 } };
const eggs: MealItem = { foodId: 'egg-boiled', name: 'Яйце варене', grams: 100, unit: { name: 'шт', qty: 2, grams: 50 } };

describe('habits (D28)', () => {
  const entries = [
    meal('2026-10-01', '08:00', 'Сніданок', [oats, kefir]),
    meal('2026-10-02', '08:10', 'Сніданок', [oats, kefir]),
    meal('2026-10-03', '08:05', 'Сніданок', [eggs, kefir]),
    meal('2026-10-03', '13:00', 'Обід', [eggs]),
    meal('2026-08-01', '08:00', 'Сніданок', [{ name: 'Старе', grams: 100 }]),     // older than 30 days
    meal('2026-10-03', '19:00', 'Вечеря', [{ name: 'Пропущене', grams: 1 }], 'skipped'),
  ];
  it('frequent lines with the last amount used', () => {
    const f = frequentItems(entries, '2026-10-04');
    expect(f.map((x) => [x.item.name, x.count])).toEqual([['Кефір 2,5 %', 3], ['Яйце варене', 2], ['Вівсянка на воді', 2]]);
  });
  it('earlier meals of the same name, newest first, no duplicates', () => {
    const m = earlierMeals(entries, 'Сніданок', '2026-10-04');
    expect(m.map((e) => e.at.slice(0, 10))).toEqual(['2026-10-03', '2026-10-02', '2026-08-01']);
  });
  it('yesterday’s meals to copy, skipped ones left out', () => {
    expect(mealsOf(entries, '2026-10-03').map((e) => e.title)).toEqual(['Сніданок', 'Обід']);
  });
});

describe('week summary (D29)', () => {
  it('counts the days that kept the targets', () => {
    const plan = { ...examplePlan(new Date('2026-09-01T12:00:00')), modes: [] };
    const big: MealItem = { foodId: 'buckwheat-boiled', name: 'Гречка варена', grams: 1000 };           // 210 g carbs > 190
    const protein: MealItem = { foodId: 'chicken-breast-cooked', name: 'Курка', grams: 450 };           // 139.5 g ≥ 126
    const water = (date: string, ml: number): DayEntry => ({ id: date + 'w', at: `${date}T10:00:00+03:00`, kind: 'water', status: 'done', title: 'Вода', waterMl: ml });
    const entries = [
      meal('2026-10-02', '13:00', 'Обід', [protein]), water('2026-10-02', 2500),
      // R06: under the carbs limit counts only for a day the person said is fully written
      { id: 'c2', at: '2026-10-02T23:59:00+03:00', kind: 'note' as const, status: 'done' as const, title: 'Усе записано', checkKey: FOOD_COMPLETE },
      meal('2026-10-03', '13:00', 'Обід', [big]), water('2026-10-03', 1000),
    ];
    const s = weekSummary({ plan, entries, foods, today: '2026-10-04',
      workouts: [{ id: 'w', date: '2026-10-03', durationMin: 30, equipment: '', exercises: [] }] });
    expect(s).toMatchObject({ from: '2026-09-28', days: 2, carbsOk: 1, proteinOk: 1, waterOk: 1, workouts: 1 });
    // without the mark the same day proves no keeping of the limit (the rest may be unwritten); going over is proven
    expect(weekSummary({ plan, entries: entries.filter((e) => e.id !== 'c2'), foods, today: '2026-10-04', workouts: [] })).toMatchObject({ carbsOk: 0 });
  });
});

describe('good habits (D38)', () => {
  it('a run of calendar days up to today, an unfinished today breaks nothing, a day without records breaks the run (R06)', async () => {
    const { habits } = await import('../../src/domain/habits');
    const { FOODS } = await import('../../src/data/foods');
    const foods = new Map(FOODS.map((f) => [f.id, f]));
    const plan = { constraints: [], prescriptions: [], modes: [], targets: { proteinG: 100 } };
    const day = (d: string, g: number) => ({ id: d, at: `${d}T13:00:00+03:00`, kind: 'meal' as const, status: 'done' as const, title: 'Обід',
      items: [{ foodId: 'chicken-breast', name: 'Куряче філе (сире)', grams: g }] });
    // 23 g protein per 100 g: 450 g ≈ 103 g ✓, 200 g ✗
    const entries = [day('2026-10-01', 450), day('2026-10-02', 200), day('2026-10-03', 450), day('2026-10-05', 450), day('2026-10-06', 450), day('2026-10-07', 200)];
    const [h] = habits({ plan, entries, workouts: [], foods, today: '2026-10-07' });
    // R06: 4 has no records — the run is 5, 6 (calendar days); 2 and 7 are under the target in a day not marked as fully written —
    // unknown, neither met nor missed; 7 is today, not over
    expect(h).toMatchObject({ key: 'protein', streak: 2, best: 2, last7: 4, days7: 4 });
  });
});

describe('how complete a day’s food is (R06)', () => {
  it('water without food proves no carbs limit kept; one meal is not a full day; the person’s mark makes it one', async () => {
    const { dayFlags, foodState } = await import('../../src/domain/habits');
    const { FOODS } = await import('../../src/data/foods');
    const foods = new Map(FOODS.map((f) => [f.id, f]));
    const plan = { constraints: [], prescriptions: [], modes: [], targets: { carbsG: { max: 150 }, proteinG: 100 } };
    const d = '2026-10-10';
    const water: DayEntry = { id: 'w', at: `${d}T09:00:00+03:00`, kind: 'water', status: 'done', title: 'Вода', waterMl: 1500 };
    const lunch: DayEntry = { id: 'l', at: `${d}T13:00:00+03:00`, kind: 'meal', status: 'done', title: 'Обід', items: [{ foodId: 'buckwheat-boiled', name: 'Гречка варена', grams: 200 }] };
    const full: DayEntry = { id: 'c', at: `${d}T23:59:00+03:00`, kind: 'note', status: 'done', title: 'Усе записано', checkKey: FOOD_COMPLETE };
    expect(foodState([water])).toBe('none');
    const food = (f: Record<string, boolean>) => ({ carbs: f.carbs, protein: f.protein }); // the food habits only
    expect(food(dayFlags(plan, [water], d, [], foods))).toEqual({ carbs: undefined, protein: undefined }); // a sum of zero is no success
    expect(foodState([water, lunch])).toBe('partial');
    expect(food(dayFlags(plan, [water, lunch], d, [], foods))).toEqual({ carbs: undefined, protein: undefined }); // under the limit and under the protein target — unknown either way
    expect(foodState([water, lunch, full])).toBe('complete');
    expect(food(dayFlags(plan, [water, lunch, full], d, [], foods))).toEqual({ carbs: true, protein: false });
    const lots: DayEntry = { ...lunch, id: 'x', items: [{ foodId: 'buckwheat-boiled', name: 'Гречка варена', grams: 900 }, { foodId: 'chicken-breast', name: 'Куряче філе (сире)', grams: 450 }] };
    expect(food(dayFlags(plan, [lots], d, [], foods))).toEqual({ carbs: false, protein: true }); // over the limit, and the target reached — proven by any records
  });
});

