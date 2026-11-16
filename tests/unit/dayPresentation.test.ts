import { describe, expect, it } from 'vitest';
import { presentDay } from '../../src/domain/dayPresentation';
import { LEGACY_FEATURE_CONTEXT, type FeatureContext } from '../../src/domain/features';
import type { DayEntry, Plan } from '../../src/domain/types';
import { buildChecklist } from '../../src/domain/checklist';
import { dayRhythm } from '../../src/domain/rhythm';
import { dayFocus } from '../../src/domain/reminders';
import { visibleChecklist } from '../../src/domain/visibility';
import type { Observation } from '../../src/domain/observation';
import { MODULE_IDS } from '../../src/domain/features';

const date = '2026-11-04';
const now = new Date(`${date}T12:00:00+02:00`);
const plan: Plan = { constraints: [], modes: [], targets: { waterMl: 2000 }, prescriptions: [
  { id: 'a', kind: 'medication', title: 'Synthetic A', source: 'Clinic A', dose: '1 unit', schedule: { times: ['08:00', '18:00'] } },
] };
const meal: DayEntry = { id: 'meal', kind: 'meal', status: 'planned', at: `${date}T13:00:00+02:00`, title: 'Synthetic lunch' };
const args = (entries: DayEntry[] = []) => ({ plan, date, now, entries, foods: new Map(), workouts: [], context: { ...LEGACY_FEATURE_CONTEXT, modules: { ...LEGACY_FEATURE_CONTEXT.modules, workout: false } } });

describe('day presentation: preservation adapter', () => {
  it('keeps the existing checklist, timeline and priority rules rather than reimplementing them', () => {
    const input = args([meal]); const result = presentDay(input);
    const checklist = visibleChecklist(buildChecklist(input), input.context);
    expect(result.checklist).toEqual(checklist);
    expect(result.rhythm).toEqual(dayRhythm({ entries: input.entries, checklist, date }));
    expect(result.focus).toEqual(dayFocus(input));
    expect(result.focus.now?.time).toBe('08:00'); // unresolved past dose remains a review, never an instruction to take it
    expect(result.focus.now?.meds?.[0]?.prescriptionId).toBe('a');
  });

  it('keeps water goals and ad-hoc records out of the prescribed-action denominator', () => {
    const water: DayEntry = { id: 'water', kind: 'water', status: 'done', at: `${date}T10:00:00+02:00`, title: 'Water', waterMl: 2000 };
    const result = presentDay(args([water, { ...meal, status: 'done' }]));
    expect(result.goals).toEqual([expect.objectContaining({ kind: 'water', done: true })]);
    expect(result.execution).toMatchObject({ total: 2, done: 0, pending: 2, skipped: 0, uncertain: 0 });
    expect(result.records).toHaveLength(2);
  });

  it('keeps confirmed skip reasons, late completion and uncertainty distinct without duplicate dose rows', () => {
    const records: DayEntry[] = [
      { id: 'skip', kind: 'med', title: 'A', status: 'skipped', at: `${date}T08:00:00+02:00`, checkKey: 'med:a:08:00', skipReason: 'Synthetic reason' },
      { id: 'uncertain', kind: 'med', title: 'A', status: 'planned', adherence: 'uncertain', at: `${date}T18:00:00+02:00`, checkKey: 'med:a:18:00' },
      { ...meal, status: 'done', adherence: 'completed_late', plannedAt: meal.at, at: `${date}T14:00:00+02:00` },
    ];
    const result = presentDay(args(records));
    expect(result.execution).toMatchObject({ total: 2, done: 0, pending: 0, skipped: 1, uncertain: 1 });
    expect(result.records.map(row => row.outcome)).toEqual(['skipped', 'completed_late', 'uncertain']);
    expect(result.records[0]!.entry.skipReason).toBe('Synthetic reason');
    expect(result.focus.now).toBeUndefined();
  });

  it('suppresses disabled modules in every projection while leaving the input and its history intact', () => {
    const input = args([meal]);
    const context: FeatureContext = { ...input.context, modules: { ...input.context.modules, meds: false, food: false, water: false } };
    const result = presentDay({ ...input, context });
    expect(result.entries).toEqual([]); expect(result.rhythm.nodes).toEqual([]);
    expect(result.checklist.items).toEqual([]); expect(result.focus).toEqual({ missed: [] });
    expect(input.entries).toEqual([meal]); expect(input.plan).toBe(plan);
  });

  it('retains recorded facts on a light day while the existing observation rules neutralise voluntary goals', () => {
    const recorded = { ...meal, status: 'done' as const };
    const observation: Observation = { now, events: MODULE_IDS.map(module => ({ id: module, v: 1, kind: 'module', module,
      enabled: true, source: 'onboarding', at: '2026-11-01T00:00:00+02:00' })), neutral: { [date]: ['food', 'water', 'workout'] } };
    const result = presentDay({ ...args([recorded, meal]), light: true, observation });
    expect(result.entries).toEqual([]); expect(result.goals).toEqual([]);
    expect(result.records).toEqual([{ entry: recorded, outcome: 'completed' }]);
    expect(result.execution.total).toBe(2); expect(result.focus.now?.kind).toBe('med');
  });

  it('does not invent current actions for future days or borrow tasks from today for historical days', () => {
    expect(presentDay({ ...args(), date: '2026-11-05' }).focus).toEqual({ missed: [] });
    const previous = presentDay({ ...args(), date: '2026-11-03' });
    expect(previous.focus.now?.time).toBe('08:00'); expect(previous.focus.now?.late).toBe(959);
    expect(previous.focus.missed.map(item => item.time)).toEqual(['18:00']);
  });

  it('reuses snooze keys and never modifies dose times, source provenance, unknown times or caller ordering', () => {
    const records = [{ ...meal, status: 'done' as const, timeUnknown: true as const },
      { id: 'early', kind: 'note' as const, status: 'done' as const, at: `${date}T07:00:00+02:00`, title: 'Note' }];
    const before = JSON.stringify({ plan, records });
    const result = presentDay({ ...args(records), snoozed: { [`med:${date}:08:00`]: now.getTime() + 60000 } });
    expect(result.focus.next?.time).toBe('18:00');
    expect(result.records[0]!.entry.id).toBe('early');
    expect(result.records[1]!.entry.timeUnknown).toBe(true);
    expect(result.execution.items[0]!.prescriptionId).toBe('a');
    expect(JSON.stringify({ plan, records })).toBe(before);
  });
});
