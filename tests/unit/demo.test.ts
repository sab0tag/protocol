import { describe, expect, it } from 'vitest';
import { demoData, DEMO_DAYS } from '../../src/data/demo';
import { FOODS } from '../../src/data/foods';
import { examplePlan } from '../../src/data/seed.example';
import { buildReport, reportText } from '../../src/domain/report';

const now = new Date('2026-10-17T12:00:00');
const foods = new Map(FOODS.map((f) => [f.id, f]));

describe('the example weeks and the report’s «Головне» (D79)', () => {
  const d = demoData(foods, now);
  const plan = examplePlan(now);
  const r = buildReport({ from: '2026-10-03', to: '2026-10-17', plan, ...d, foods, now });

  it('every row is marked demo and has its food', () => {
    for (const rows of Object.values(d)) for (const x of rows as { demo?: true }[]) expect(x.demo).toBe(true);
    expect(d.entries.filter((e) => e.kind === 'meal').flatMap((e) => e.items!).every((i) => i.foodId && i.grams > 0)).toBe(true);
  });

  it('shows what records are for: doses, limits, coincidences, sleep, weight, labs', () => {
    expect(r.meds).toMatchObject({ taken: DEMO_DAYS - 3, due: DEMO_DAYS, missed: [{ title: 'Вітамін D', count: 3 }], list: [{ title: 'Вітамін D', taken: DEMO_DAYS - 3, due: DEMO_DAYS }] }); // today: 08:30 has come, not taken… today has no records
    expect(r.deviations?.by[0]).toEqual({ title: 'Непереносимість лактози', count: 4 });
    expect(r.coincidences.some((c) => c.startsWith('«Здуття» — 4 з 4'))).toBe(true);
    expect(r.coincidences.some((c) => c.startsWith('Сон після днів, коли вечеря пізніше 20:00'))).toBe(true);
    expect(r.weightPace).toBeLessThan(0);
    expect(r.habits.find((h) => h.key === 'water')).toEqual({ key: 'water', met: 10, of: 14 }); // not all zeros, not all perfect
    expect(r.labs.map((l) => l.name)).toEqual(['Глюкоза натще', 'Феритин']);
    const text = reportText(r, (x) => x);
    expect(text.split('\n')[1]).toBe('Ліки: відмічено прийнятими 11 з 14 доз у дні з записами (79 %) — Вітамін D — пропущено 3');
  });
});

describe('a medicine added today is not «missed» before it (D97)', () => {
  it('the report counts doses from the day it entered the plan', async () => {
    const { buildChecklist } = await import('../../src/domain/checklist');
    const now2 = new Date('2026-10-17T21:00:00');
    const d = demoData(foods, now2);
    const plan = examplePlan(now2);
    const withNew = { ...plan, prescriptions: [...plan.prescriptions, { id: 'm', kind: 'medication' as const, title: 'Метформін', source: 'Лікар', since: '2026-10-17', schedule: { times: ['08:00'] } }] };
    const r = buildReport({ from: '2026-10-03', to: '2026-10-17', plan: withNew, ...d, foods, now: now2 });
    expect(r.meds!.list.find((m) => m.title === 'Метформін')?.due ?? 0).toBe(0); // nothing due before the day it was added
    expect(r.meds!.list.find((m) => m.title === 'Вітамін D')).toMatchObject({ taken: 11, due: 14 });
    const past = buildChecklist({ plan: withNew, date: '2026-10-10', entries: [], workouts: [], foods, now: now2 });
    expect(past.items.map((i) => i.title)).not.toContain('Метформін');
  });
});
