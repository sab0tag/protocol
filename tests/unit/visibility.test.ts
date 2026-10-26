import { afterEach, describe, expect, it } from 'vitest';
import { ALL_MODULES, can, type FeatureContext } from '../../src/domain/features';
import { entryVisible, visibleChecklist, visibleReport, visibleWeek } from '../../src/domain/visibility';
import { buildChecklist } from '../../src/domain/checklist';
import { buildReport, reportText } from '../../src/domain/report';
import { weekSummary } from '../../src/domain/habits';
import type { DayEntry, Plan } from '../../src/domain/types';
import { ProtocolDB } from '../../src/data/db';
import { appendModuleEvents, enableAllModules } from '../../src/data/modulePreferences';
import { modulePreferences } from '../../src/domain/modulePreferences';
const foods = new Map();
const context = (modules = {}): FeatureContext => ({ modules: { ...ALL_MODULES, ...modules }, tier: 'free' });
const date = '2026-10-26';
const plan: Plan = { prescriptions: [{ id: 'med', title: 'Private medicine', kind: 'medication', dose: '1', schedule: { times: ['08:00'] }, source: '' }],
  constraints: [], modes: [], targets: { waterMl: 2000, proteinG: 100 } };
const meal: DayEntry = { id: 'meal', kind: 'meal', at: date + 'T12:00:00+02:00', title: 'Private meal', status: 'done', items: [] };

describe('current UI visibility without data/history changes', () => {
  it('hides facts in a disabled view and preserves always-on symptoms and ordinary notes', () => {
    const off = context({ food: false, meds: false, water: false, workout: false, wellbeing: false });
    expect(entryVisible(meal, off)).toBe(false);
    expect(entryVisible({ ...meal, kind: 'note', checkKey: 'food:complete' }, off)).toBe(false);
    expect(entryVisible({ ...meal, kind: 'symptom' }, off)).toBe(true);
    expect(entryVisible({ ...meal, kind: 'note' }, off)).toBe(true);
    expect(entryVisible(meal, context())).toBe(true);
  });
  it('hides menu proposals, keeping actual food when only menu is off', () => {
    const c = context({ menu: false });
    const e = { ...meal, menu: { tips: [] } };
    expect(entryVisible({ ...e, status: 'planned' }, c)).toBe(false);
    expect(entryVisible(e, c)).toBe(true);
  });
  it('recounts the actionable checklist without modifying the plan or original checklist', () => {
    const all = buildChecklist({ plan, date, entries: [], workouts: [], foods, now: new Date(date + 'T12:00:00') });
    const shown = visibleChecklist(all, context({ water: false, workout: false }));
    expect(shown.items.map((i) => i.kind)).toEqual(['med']);
    expect(shown.total).toBe(1); expect(all.items.some((i) => i.kind === 'water')).toBe(true);
    expect(plan.targets.waterMl).toBe(2000);
  });
  it('uses one projection for report screen/print/share, retaining the source and symptom facts', () => {
    const raw = buildReport({ from: date, to: date, plan, entries: [meal, { ...meal, id: 'tick', kind: 'med', checkKey: 'med:med:08:00', prescriptionId: 'med' },
      { ...meal, id: 'symptom', kind: 'symptom', symptoms: ['Symptom fact'] }], workouts: [], wellbeing: [],
      weights: [{ date, kg: 90 }], foods, labs: [{ date, name: 'Private lab', value: 1, unit: '' }] });
    const off = context({ meds: false, food: false, water: false, wellbeing: false, progress: false, workout: false });
    const view = visibleReport(raw, off), text = reportText(view, (x) => x);
    expect(text).not.toContain('Private medicine'); expect(text).not.toContain('Private lab'); expect(text).not.toContain('90');
    expect(text).toContain('Symptom fact'); expect(view.checklistPct).toBeUndefined();
    expect(raw.meds).toBeDefined(); expect(raw.weightNow).toBe(90);
  });
  it('does not show a composite score or disabled goals in the week; a weight override remains independent', () => {
    const summary = weekSummary({ plan, entries: [meal], workouts: [], foods, today: date });
    const shown = visibleWeek(summary, context({ food: false, water: false, workout: false }));
    expect(shown.checklistPct).toBeUndefined(); expect(shown.proteinOk).toBeUndefined(); expect(shown.showWorkouts).toBe(false);
    const c = { ...context({ wellbeing: false, progress: false }), overrides: { 'wellbeing.weight': true } };
    expect(can('wellbeing.weight', c)).toBe(true); expect(can('progress', c)).toBe(false);
  });
});

const databases: ProtocolDB[] = [];
afterEach(async () => { for (const d of databases.splice(0)) await d.delete(); });
it('enables all atomically without replacing the already-on medication event or its reminder activation stamp', async () => {
  const d = new ProtocolDB('all-' + crypto.randomUUID()); databases.push(d);
  await appendModuleEvents(d, [
    { id: 'keep-med', v: 1, at: '2026-01-01T00:00:00.000Z', kind: 'module', module: 'meds', enabled: true, source: 'migration', reason: 'plan', before: 'unknown' },
    { id: 'food-off', v: 1, at: '2026-01-01T00:00:00.000Z', kind: 'module', module: 'food', enabled: false, source: 'manual' },
    { id: 'weight-off', v: 1, at: '2026-01-01T00:00:00.000Z', kind: 'weight', enabled: false, source: 'manual' },
  ]);
  await enableAllModules(d, '2026-10-26T08:00:00.000Z');
  const events = await d.moduleEvents.toArray(), prefs = modulePreferences(events);
  expect(prefs.modules).toEqual(ALL_MODULES); expect(prefs.overrides['wellbeing.weight']).toBe(true);
  expect(events.filter((e) => e.kind === 'module' && e.module === 'meds').map((e) => e.id)).toEqual(['keep-med']);
  await enableAllModules(d, '2026-10-26T09:00:00.000Z'); expect(await d.moduleEvents.count()).toBe(events.length);
});
