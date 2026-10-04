import { describe, expect, it } from 'vitest';
import { exportAll, exportDue, importAll, parseExport } from '../../src/data/backup';
import { ensureSeeded, ProtocolDB } from '../../src/data/db';
import { FOODS } from '../../src/data/foods';
import { examplePlan } from '../../src/data/seed.example';
import { labRows, patterns, tooFastTwoWeeks, weeklyWeights, weightSummary } from '../../src/domain/progress';
import { buildReport, reportText } from '../../src/domain/report';
import type { DayEntry, Wellbeing, Workout } from '../../src/domain/types';

const foods = new Map(FOODS.map((f) => [f.id, f]));

describe('progress (§5.7)', () => {
  const logs = [
    { date: '2026-09-07', kg: 100 }, { date: '2026-09-09', kg: 99.6 },  // week of 7 Sep: 99.8
    { date: '2026-09-14', kg: 99.4 },                                    // −0.4
    { date: '2026-09-21', kg: 98.6 },                                    // −0.8 too fast
    { date: '2026-09-28', kg: 97.9 },                                    // −0.7 too fast
  ];
  it('averages a week and compares with the previous one', () => {
    const w = weeklyWeights(logs, 0.5);
    expect(w.map((x) => [x.week, x.kg, x.change])).toEqual([
      ['2026-09-07', 99.8, undefined], ['2026-09-14', 99.4, -0.4], ['2026-09-21', 98.6, -0.8], ['2026-09-28', 97.9, -0.7]]);
    expect(w.map((x) => x.tooFast)).toEqual([false, false, true, true]);
  });
  it('warns only when the loss was too fast two weeks in a row', () => {
    expect(tooFastTwoWeeks(weeklyWeights(logs, 0.5))).toBe(true);
    expect(tooFastTwoWeeks(weeklyWeights(logs.slice(0, 4), 0.5))).toBe(false);
    expect(tooFastTwoWeeks(weeklyWeights(logs, undefined))).toBe(false);
  });
  it('current weight and the change since the start', () => {
    expect(weightSummary(logs)).toMatchObject({ start: { kg: 100 }, now: { kg: 97.9 }, delta: -2.1 });
  });
  it('labs: was → now → target, one row per test', () => {
    const rows = labRows([
      { date: '2026-08-01', name: 'Феритин', value: 520, unit: 'нг/мл', target: '< 300' },
      { date: '2026-10-01', name: 'Феритин', value: 410, unit: 'нг/мл' },
      { date: '2026-10-01', name: 'Глюкоза', value: 6.1, unit: 'ммоль/л' },
    ]);
    expect(rows.find((r) => r.name === 'Феритин')).toMatchObject({ was: { value: 520 }, now: { value: 410 }, target: '< 300' });
    expect(rows).toHaveLength(2);
  });
});

describe('patterns (§6.4)', () => {
  const meal = (date: string, grams: number): DayEntry => ({ id: date, at: `${date}T13:00:00+03:00`, kind: 'meal', status: 'done',
    title: 'Обід', items: [{ foodId: 'chicken-thigh', name: 'Філе стегна', grams }] });
  it('a symptom mostly on big-meat days', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
    const entries = [meal(days[0]!, 250), meal(days[1]!, 220), meal(days[2]!, 260), meal(days[3]!, 120)];
    const wellbeing: Wellbeing[] = days.slice(0, 3).map((date) => ({ date, symptoms: ['Тяжкість після їжі'] }));
    const p = patterns({ entries, wellbeing, workouts: [], foods });
    expect(p[0]?.text).toContain('3 з 3');
    expect(patterns({ entries, wellbeing: wellbeing.slice(0, 2), workouts: [], foods })).toEqual([]);   // < 3 times
  });
  it('energy on training days vs others, from 10 days of data', () => {
    const wellbeing: Wellbeing[] = Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, energy: (i % 2 ? 4 : 3) as 3 | 4, symptoms: [] }));
    const workouts: Workout[] = wellbeing.filter((_, i) => i % 2).map((w) => ({ id: w.date, date: w.date, durationMin: 30, equipment: '', exercises: [] }));
    expect(patterns({ entries: [], wellbeing, workouts, foods })[0]?.text).toBe('Енергія в дні тренувань — 4.0, в інші дні — 3.0 (з 5)');
    expect(patterns({ entries: [], wellbeing: wellbeing.slice(0, 9), workouts, foods })).toEqual([]);
  });
});

describe('report (§5.8)', () => {
  it('counts the period', () => {
    const plan = { ...examplePlan(new Date('2026-09-01T12:00:00')), modes: [], questions: ['Чи можна каву?'] };
    const entries: DayEntry[] = [
      { id: 'm', at: '2026-10-01T08:40:00+03:00', kind: 'med', status: 'done', title: 'Вітамін D', checkKey: 'med:p-vitd:08:30' },
    ];
    const r = buildReport({ from: '2026-10-01', to: '2026-10-02', plan, entries, foods,
      workouts: [{ id: 'w', date: '2026-10-01', durationMin: 30, equipment: '', exercises: [] }],
      wellbeing: [{ date: '2026-10-01', energy: 3, symptoms: ['Втома'] }, { date: '2026-10-02', energy: 4, symptoms: ['Втома', 'Здуття'] }],
      weights: [{ date: '2026-10-01', kg: 98 }, { date: '2026-10-02', kg: 97.8 }] });
    expect(r).toMatchObject({ days: 2, workouts: 1, avgEnergy: 3.5, weightStart: 98, weightNow: 97.8,
      symptoms: [{ name: 'Втома', count: 2 }, { name: 'Здуття', count: 1 }] });
    // day 1: vitamin + workout of 4 (med, water, workout, dinner); day 2: 0 of 3 (no workout: rest day) → 2 / 7
    expect(r.checklistPct).toBe(29);
    expect(reportText(r, (d) => d)).toContain('Мої питання:\n• Чи можна каву?');
  });
});

describe('backup (§5.8, §8)', () => {
  it('export → import into an empty device gives the same data', async () => {
    const a = new ProtocolDB('backup-a');
    await ensureSeeded(a);
    await a.entries.add({ id: 'x', at: '2026-10-04T09:00:00+03:00', kind: 'water', status: 'done', title: 'Вода', waterMl: 250 });
    await a.weights.put({ date: '2026-10-04', kg: 98 });
    const text = JSON.stringify(await exportAll(a));
    const b = new ProtocolDB('backup-b');
    await importAll(parseExport(text), b);
    expect(await b.entries.get('x')).toMatchObject({ waterMl: 250 });
    expect(await b.weights.get('2026-10-04')).toMatchObject({ kg: 98 });
    expect((await b.plan.get('main'))?.constraints).toHaveLength(5);
    a.close(); b.close();
  });
  it('refuses a wrong file before touching anything', () => {
    expect(() => parseExport('{"a":1}')).toThrow('не файл копії');
    expect(() => parseExport('not json')).toThrow('JSON');
    expect(() => parseExport(JSON.stringify({ format: 'protocol-export', version: 99 }))).toThrow('новішої');
  });
  it('reminds a week after the last export', () => {
    expect(exportDue(undefined, undefined, '2026-10-04')).toBe(false);
    expect(exportDue(undefined, '2026-10-03', '2026-10-04')).toBe(true);
    expect(exportDue('2026-09-30', '2026-09-01', '2026-10-04')).toBe(false);
    expect(exportDue('2026-09-27', '2026-09-01', '2026-10-04')).toBe(true);
  });
});
