import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { examplePlan } from '../../src/data/seed.example';
import { earlierMeals, frequentItems, mealsOf, weekSummary } from '../../src/domain/habits';
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
      meal('2026-10-03', '13:00', 'Обід', [big]), water('2026-10-03', 1000),
    ];
    const s = weekSummary({ plan, entries, foods, today: '2026-10-04',
      workouts: [{ id: 'w', date: '2026-10-03', durationMin: 30, equipment: '', exercises: [] }] });
    expect(s).toMatchObject({ from: '2026-09-28', days: 2, carbsOk: 1, proteinOk: 1, waterOk: 1, workouts: 1 });
  });
});
