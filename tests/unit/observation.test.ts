import { describe, expect, it } from 'vitest';
import { MODULE_IDS, type ModuleId } from '../../src/domain/features';
import type { ModuleChoice, ModuleEvent } from '../../src/domain/modulePreferences';
import { coverage, observedState, observedTask, observedTargets, scoredDay, trackingInfo, type Observation } from '../../src/domain/observation';
import { buildChecklist, doseDue } from '../../src/domain/checklist';
import { dayFlags, habits, weekSummary, FOOD_COMPLETE } from '../../src/domain/habits';
import { buildReport, reportText, trackingLines } from '../../src/domain/report';
import { dayFocus } from '../../src/domain/reminders';
import { dayRhythm } from '../../src/domain/rhythm';
import { patterns } from '../../src/domain/progress';
import type { DayEntry, Food, Plan } from '../../src/domain/types';

const at = (date: string, time = '00:00') => new Date(`${date}T${time}:00`).toISOString();
const change = (id: string, module: ModuleId, enabled: boolean, date: string, time = '00:00'): ModuleChoice =>
  ({ id, v: 1, kind: 'module', source: 'manual', at: at(date, time), module, enabled });
const initial = (enabled: readonly ModuleId[] = MODULE_IDS): ModuleEvent[] => MODULE_IDS.map((module) => ({
  id: `init-${module}`, v: 1, at: at('2026-10-01'), kind: 'module', module, source: 'onboarding', enabled: enabled.includes(module),
}));
const observe = (events: readonly ModuleEvent[] = initial(), now = new Date('2026-10-30T12:00:00')): Observation => ({ events, now });
const foods = new Map<string, Food>();
const plan: Plan = { prescriptions: [{ id: 'p', kind: 'medication', title: 'Препарат', dose: '1 табл.', source: 'Лікар',
  since: '2026-10-01', schedule: { times: ['08:00', '20:00'] } }], constraints: [], modes: [],
  targets: { proteinG: 100, waterMl: 2000, carbsG: { max: 150 }, lastMealBy: '19:00' } };
const meal = (date: string, id = `${date}-meal`): DayEntry => ({ id, at: at(date, '12:00'), kind: 'meal', status: 'done', title: 'Їжа',
  items: [{ name: 'Страва', grams: 100, manual: { kcal: 500, protein: 100, carbs: 100, fat: 20 } }] });
const day = (date: string): DayEntry[] => [meal(date), { id: `${date}-complete`, at: at(date, '23:59'), kind: 'note', status: 'done', title: '', checkKey: FOOD_COMPLETE },
  { id: `${date}-water`, at: at(date, '12:00'), kind: 'water', status: 'done', title: 'Вода', waterMl: 2000 }];
const checklist = (o: Observation, date: string, entries: DayEntry[] = []) => buildChecklist({ plan, date, entries, workouts: [], foods, now: o.now, observation: o });

describe('observation periods (D135)', () => {
  it('leaves a toggled daily target neutral, even after off → on within the same day', () => {
    const o = observe([...initial(), change('off', 'food', false, '2026-10-20', '10:00'), change('on', 'food', true, '2026-10-20', '14:00')]);
    expect(coverage(o, 'food', '2026-10-19')).toBe('on');
    expect(coverage(o, 'food', '2026-10-20')).toBe('partial');
    expect(coverage(o, 'food', '2026-10-21')).toBe('on');
    expect(dayFlags(plan, day('2026-10-20'), '2026-10-20', [], foods, o).carbs).toBeUndefined();
    expect(dayFlags(plan, day('2026-10-21'), '2026-10-21', [], foods, o).carbs).toBe(true);
  });

  it('respects exact midnight boundaries and the 25-hour local DST day', () => {
    const o = observe([...initial(), change('off', 'water', false, '2026-10-26')]);
    expect(coverage(o, 'water', '2026-10-25')).toBe('on');
    expect(coverage(o, 'water', '2026-10-26')).toBe('off');
    const [p] = trackingInfo(o, '2026-10-25', '2026-10-25', ['water']).intervals;
    expect((Date.parse(p!.to) - Date.parse(p!.from)) / 3_600_000).toBe(25);
  });

  it('does not label a migration timestamp as a historical start or count unknown past days', () => {
    const events: ModuleEvent[] = [{ id: 'migration', v: 1, at: at('2026-10-20', '10:00'), kind: 'module', module: 'food',
      enabled: true, source: 'migration', reason: 'records', before: 'unknown' }];
    const o = observe(events);
    expect(coverage(o, 'food', '2026-10-19')).toBe('unknown');
    expect(coverage(o, 'food', '2026-10-20')).toBe('partial');
    expect(dayFlags(plan, day('2026-10-19'), '2026-10-19', [], foods, o).carbs).toBeUndefined();
    const info = trackingInfo(o, '2026-10-19', '2026-10-21', ['food']);
    expect(info.unknown).toEqual(['food']);
    expect(info.intervals[0]).toMatchObject({ unknownStart: true });
    expect(info.intervals[0]!.since).toBeUndefined();
    expect(trackingLines(info).join(' ')).toContain('точна дата початку невідома');
  });

  it('keeps the actual activation date when the report starts later and lists each gap separately', () => {
    const o = observe([...initial(), change('off', 'food', false, '2026-10-20'), change('on', 'food', true, '2026-10-23')]);
    const early = trackingInfo(o, '2026-10-18', '2026-10-24', ['food']);
    expect(early.intervals.map((p) => [p.from, p.to, p.since])).toEqual([
      [at('2026-10-18'), at('2026-10-20'), at('2026-10-01')],
      [at('2026-10-23'), at('2026-10-25'), at('2026-10-23')],
    ]);
    const clipped = trackingInfo(o, '2026-10-24', '2026-10-24', ['food']);
    expect(clipped.intervals[0]).toMatchObject({ from: at('2026-10-24'), since: at('2026-10-23') });
  });

  it('separates weight from wellbeing while preserving an explicit override', () => {
    const o = observe([...initial(['meds']), { id: 'weight-on', v: 1, kind: 'weight', at: at('2026-10-01'), enabled: true, source: 'onboarding' }]);
    expect(coverage(o, 'wellbeing', '2026-10-20')).toBe('off');
    expect(coverage(o, 'weight', '2026-10-20')).toBe('on');
  });

  it('never turns future dates or an unfinished day into failed goals', () => {
    const o = observe(initial(), new Date('2026-10-20T10:00:00'));
    expect(coverage(o, 'food', '2026-10-21')).toBe('future');
    expect(dayFlags(plan, day('2026-10-21'), '2026-10-21', [], foods, o)).toEqual({});
    const flags = dayFlags(plan, [meal('2026-10-20')], '2026-10-20', [], foods, o);
    expect(flags.water).toBeUndefined(); expect(flags.meds).toBeUndefined();
    expect(observedState(o, 'food', Number.NaN)).toBeUndefined();
  });
});

describe('doses and tasks', () => {
  it('keeps doses before module off, excludes later doses, and never changes doseDue or the prescription', () => {
    const o = observe([...initial(), change('meds-off', 'meds', false, '2026-10-20', '18:00')]);
    const snapshot = JSON.stringify(plan);
    expect(checklist(o, '2026-10-20').items.filter((i) => i.kind === 'med').map((i) => i.time)).toEqual(['08:00']);
    expect(checklist(o, '2026-10-21').items.filter((i) => i.kind === 'med')).toEqual([]);
    expect(doseDue(plan.prescriptions[0]!, '2026-10-21', '20:00')).toBe(true);
    expect(JSON.stringify(plan)).toBe(snapshot);
    expect(dayFlags(plan, day('2026-10-20'), '2026-10-20', [], foods, o).meds).toBeUndefined();
  });

  it('starts counting only the doses whose scheduled time is within observation, with no retroactive debt', () => {
    const o = observe([...initial(['food']), change('meds-on', 'meds', true, '2026-10-20', '09:00')]);
    expect(checklist(o, '2026-10-19').items.filter((i) => i.kind === 'med')).toEqual([]);
    expect(checklist(o, '2026-10-20').items.filter((i) => i.kind === 'med').map((i) => i.time)).toEqual(['20:00']);
    expect(checklist(o, '2026-10-21').items.filter((i) => i.kind === 'med')).toHaveLength(2);
  });

  it('does not create a successful medicine day before/after a course or from PRN alone', () => {
    const short: Plan = { ...plan, prescriptions: [{ ...plan.prescriptions[0]!, since: '2026-10-21', until: '2026-10-22' },
      { ...plan.prescriptions[0]!, id: 'prn', asNeeded: true }] };
    for (const date of ['2026-10-20', '2026-10-23']) expect(dayFlags(short, day(date), date, [], foods, observe()).meds).toBeUndefined();
  });

  it('removes inactive proposed tasks from focus and rhythm while retaining recorded facts', () => {
    const o = observe(initial(['meds']));
    const planned = { ...meal('2026-10-20'), id: 'planned', status: 'planned' as const };
    const entries = [planned, meal('2026-10-20')];
    const c = checklist(o, '2026-10-20', entries);
    const rhythm = dayRhythm({ entries, date: '2026-10-20', observation: o, checklist: c, lastMealBy: '19:00' });
    expect(rhythm.nodes.some((n) => n.kind === 'entry' && n.entry.id === 'planned')).toBe(false);
    expect(rhythm.nodes.some((n) => n.kind === 'entry' && n.entry.status === 'done')).toBe(true);
    expect(rhythm.nodes.some((n) => n.kind === 'deadline')).toBe(false);
    const focus = dayFocus({ entries, plan, date: '2026-10-20', now: new Date('2026-10-20T21:30:00'), observation: o });
    expect(focus.missed.every((item) => item.kind === 'med')).toBe(true);
  });

  it('prepares neutral goals without suppressing medication observation or voluntary records', () => {
    const o: Observation = { ...observe(), neutral: { '2026-10-20': ['food', 'water', 'workout'] } };
    const c = checklist(o, '2026-10-20', day('2026-10-20'));
    expect(c.items.every((i) => i.kind === 'med')).toBe(true);
    expect(c.items).toHaveLength(2);
    expect(dayFlags(plan, day('2026-10-20'), '2026-10-20', [], foods, o).carbs).toBeUndefined();
    expect(observedTargets(plan.targets, '2026-10-20', o)).not.toHaveProperty('waterMl');
    expect(observedTask(o, 'meds', '2026-10-20', '08:00')).toBe(true);
    expect(day('2026-10-20')).toHaveLength(3);
  });
});

describe('one observation rule for the week and report', () => {
  it('uses the known food/water denominators instead of all days that have any records', () => {
    const o = observe([...initial(['meds']), change('food-on', 'food', true, '2026-10-23'), change('water-on', 'water', true, '2026-10-24')]);
    const entries = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'].flatMap((d) => day(d));
    const week = weekSummary({ plan, entries, workouts: [], foods, today: '2026-10-24', observation: o });
    expect(week.knownDays).toEqual({ carbs: 2, protein: 2, water: 1 });
    expect(week.carbsOk).toBe(2); expect(week.waterOk).toBe(1); expect(week.showWorkouts).toBe(false);
    const report = buildReport({ from: '2026-10-21', to: '2026-10-24', plan, entries, workouts: [], wellbeing: [], weights: [], foods, observation: o });
    expect(report.habits.find((h) => h.key === 'carbs')).toEqual({ key: 'carbs', met: 2, of: 2 });
    expect(report.habits.find((h) => h.key === 'water')).toEqual({ key: 'water', met: 1, of: 1 });
    expect(report.meds?.unmarked).toBe(8);
    expect(report.meds?.missed).toEqual([]); // no mark is not an explicit «skipped» action
    expect(reportText(report, (d) => d)).not.toContain('Тренувань: 0');
    expect(reportText(report, (d) => d)).toContain('Запис їжі: увімкнено з 23.10.2026');
  });

  it('preserves D128 unknown food days and calendar streak semantics across off periods', () => {
    const o = observe([...initial(), change('off', 'food', false, '2026-10-22'), change('on', 'food', true, '2026-10-24')]);
    const entries = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'].flatMap((d) => day(d));
    const f = dayFlags(plan, [], '2026-10-21', [], foods, o);
    expect(f.carbs).toBeUndefined(); expect(f.protein).toBeUndefined();
    const result = habits({ plan, entries, workouts: [], foods, today: '2026-10-24', observation: o }).find((h) => h.key === 'carbs');
    expect(result).toMatchObject({ streak: 1, last7: 2, days7: 2 });
  });

  it('retains old medication marks as facts without presenting unknown observation as non-adherence', () => {
    const o = observe([{ id: 'migration', v: 1, at: at('2026-10-25'), kind: 'module', module: 'meds', enabled: true,
      source: 'migration', reason: 'records', before: 'unknown' }]);
    const entries: DayEntry[] = [{ id: 'taken', at: at('2026-10-20', '08:00'), kind: 'med', title: 'Препарат', status: 'done', checkKey: 'med:p:08:00', prescriptionId: 'p' }];
    const r = buildReport({ from: '2026-10-20', to: '2026-10-20', plan, entries, workouts: [], wellbeing: [], weights: [], foods, observation: o });
    expect(r.meds).toBeUndefined(); expect(r.unscoredMedMarks).toBe(1); expect(r.checklistPct).toBeUndefined();
    const text = reportText(r, (d) => d);
    expect(text).toContain('1 відмітку ліків'); expect(text).not.toContain('(0 %)');
  });

  it('excludes future report dates and does not count unknown training days as non-training days in patterns', () => {
    const o = observe(initial(['food', 'wellbeing']), new Date('2026-10-25T12:00:00'));
    const r = buildReport({ from: '2026-10-25', to: '2026-10-29', plan, entries: [meal('2026-10-28')], workouts: [], wellbeing: [], weights: [], foods, observation: o });
    expect(r.to).toBe('2026-10-25'); expect(r.days).toBe(1);
    const wellbeing = Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${String(i + 10).padStart(2, '0')}`, energy: (i % 2 ? 4 : 3) as 3 | 4, symptoms: [] }));
    const workouts = wellbeing.filter((_, i) => i % 2).map((w) => ({ id: w.date, date: w.date, durationMin: 30, equipment: '', exercises: [] }));
    expect(patterns({ entries: [], wellbeing, workouts, foods, observation: o }).some((p) => p.text.startsWith('Енергія в дні тренувань'))).toBe(false);
  });

  it('keeps all demo modules observable even if personal-style events say off', () => {
    const o = { ...observe(initial([])), demo: true };
    expect(scoredDay(o, 'food', '2026-10-20')).toBe(true);
    expect(checklist(o, '2026-10-20').items.filter((i) => i.kind === 'med')).toHaveLength(2);
  });
});
