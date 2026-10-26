import { afterEach, describe, expect, it } from 'vitest';
import { ProtocolDB, ensureSeeded } from '../../src/data/db';
import { initialiseModulePreferences, setModuleEnabled, setWeightEnabled } from '../../src/data/modulePreferences';
import { acceptPlanModules, ensureProgressOpened, finishModuleOnboarding } from '../../src/data/moduleStart';
import { hasActivity, onboardingAnchor, planModuleSuggestions, progressOpening, starterModules } from '../../src/domain/moduleStart';
import { isModuleEvent, moduleChoiceAt, modulePreferences, type ModuleEvent } from '../../src/domain/modulePreferences';
import type { Plan, Prescription } from '../../src/domain/types';
import { exportAll, importAll, parseExport } from '../../src/data/backup';
import { newCode, deriveKeys, parseCode } from '../../src/sync/crypto';
import { syncOnce, type Api, type RemoteRecord } from '../../src/sync/engine';
import { policyFromEvents } from '../../server/src/reminderPolicy';

const empty = (): Plan => ({ constraints: [], prescriptions: [], targets: {}, modes: [] });
const med = (id = 'med'): Prescription => ({ id, kind: 'medication', title: 'Medicine', source: 'Doctor', dose: '1', schedule: { times: ['08:00'] } });
const diet = { id: 'diet', tag: 'glycemic' as const, title: 'Diet', source: 'Doctor', reason: '', active: true };
const start = new Date('2026-10-19T12:00:00+03:00');
const databases: ProtocolDB[] = [];
async function fresh() {
  const d = new ProtocolDB('module-start-' + crypto.randomUUID()); databases.push(d); await ensureSeeded(d);
  await initialiseModulePreferences(d, start.toISOString(), {}, { minimalNew: true }); return d;
}
afterEach(async () => { for (const d of databases.splice(0)) await d.delete(); });

describe('confirmed starter policy (D138)', () => {
  it.each([
    ['four medicines + diet', { ...empty(), constraints: [diet], prescriptions: [med('1'), med('2'), med('3'), med('4')] }, ['meds'], false],
    ['diet only', { ...empty(), constraints: [diet] }, ['food'], false],
    ['water target without medicines', { ...empty(), targets: { waterMl: 2000 } }, ['food', 'water'], false],
    ['empty plan without invented goals', empty(), ['food'], false],
    ['confirmed activity', { ...empty(), prescriptions: [{ id: 'a', kind: 'lifestyle', title: 'Activity', source: '', activity: 'walking' }] }, ['food', 'workout'], false],
    ['weight goal', { ...empty(), targets: { weightGoalKg: 90 } }, ['food'], true],
  ] as const)('%s', (_name, p, on, weight) => {
    const actual = starterModules(p as Plan);
    expect(Object.entries(actual.modules).filter(([, enabled]) => enabled).map(([key]) => key).sort()).toEqual([...on].sort());
    expect(actual.weight).toBe(weight);
  });
  it('includes PRN/supplements, but never infers activity from free words or a non-lifestyle field', () => {
    expect(starterModules({ ...empty(), prescriptions: [{ ...med(), kind: 'supplement', asNeeded: true, schedule: undefined }] }).modules.meds).toBe(true);
    expect(hasActivity({ id: 'a', kind: 'lifestyle', title: 'Ходьба і силові вправи', source: '' })).toBe(false);
    expect(hasActivity({ ...med(), activity: 'walking' })).toBe(false);
  });
  it('starts only a truly empty new profile minimally and leaves legacy evidence/access intact', async () => {
    const d = await fresh();
    expect((await d.moduleEvents.toArray()).map((e) => e.kind).sort()).toEqual(['initialised', 'onboarding-started']);
    expect(Object.values(modulePreferences(await d.moduleEvents.toArray()).modules).some(Boolean)).toBe(false);
    await d.plan.update('main', { prescriptions: [med()] }); // confirmed OCR lines are not module choices
    await initialiseModulePreferences(d, new Date().toISOString(), {}, { minimalNew: true });
    expect((await d.moduleEvents.toArray()).filter((e) => e.kind === 'module')).toHaveLength(0);
    const old = new ProtocolDB('legacy-start-' + crypto.randomUUID()); databases.push(old); await ensureSeeded(old);
    await old.entries.put({ id: 'old', kind: 'meal', at: start.toISOString(), title: 'Fact', status: 'done' });
    await initialiseModulePreferences(old, start.toISOString(), {}, { minimalNew: true });
    expect(Object.values(modulePreferences(await old.moduleEvents.toArray()).modules).every(Boolean)).toBe(true);
  });
  it('commits the final plan/choices once; repeat onboarding preserves first date and manual choices', async () => {
    const d = await fresh();
    const result = await finishModuleOnboarding(d, { patch: { ...empty(), prescriptions: [med()], constraints: [diet] }, weightKg: 95 }, start);
    expect(result.fresh).toBe(true);
    expect(modulePreferences(await d.moduleEvents.toArray()).modules).toMatchObject({ meds: true, food: false, water: false, menu: false, progress: false });
    await setModuleEnabled(d, 'meds', false, 'manual', '2026-10-20T10:00:00.000Z');
    const count = await d.moduleEvents.count();
    const repeat = await finishModuleOnboarding(d, { patch: { targets: { waterMl: 2000 } }, choices: { meds: true, water: true } }, new Date('2026-10-22T12:00:00+03:00'));
    expect(repeat.fresh).toBe(false); expect(repeat.after.onboardedAt).toBe('2026-10-19');
    expect(await d.moduleEvents.count()).toBe(count);
    expect(modulePreferences(await d.moduleEvents.toArray()).modules).toMatchObject({ meds: false, water: false });
    expect(await d.weights.get('2026-10-19')).toMatchObject({ kg: 95 });
  });
  it('does not install a false weight override unless the user chose it, and preserves a standalone goal', async () => {
    const a = await fresh(); await finishModuleOnboarding(a, {}, start);
    await setModuleEnabled(a, 'wellbeing', true, 'manual', '2026-10-20T10:00:00.000Z');
    expect(modulePreferences(await a.moduleEvents.toArray()).overrides).toEqual({});
    const b = await fresh(); await finishModuleOnboarding(b, { patch: { targets: { weightGoalKg: 90 } } }, start);
    expect(modulePreferences(await b.moduleEvents.toArray())).toMatchObject({ modules: { wellbeing: false, progress: false }, overrides: { 'wellbeing.weight': true } });
  });
  it('rolls back first-start history and weight when the plan cannot be written', async () => {
    const d = await fresh(), before = await d.moduleEvents.toArray();
    d.plan.hook('updating', () => { throw new Error('disk refused'); });
    await expect(finishModuleOnboarding(d, { weightKg: 90 }, start)).rejects.toThrow('disk refused');
    expect(await d.moduleEvents.toArray()).toEqual(before); expect(await d.weights.count()).toBe(0);
    expect((await d.plan.get('main'))?.onboardedAt).toBeUndefined();
  });
});

describe('day eight across clocks, restore and devices', () => {
  it('uses local calendar midnight across the 25-hour DST day, and opens once even after a late launch', async () => {
    const d = await fresh(); await finishModuleOnboarding(d, {}, start);
    const anchor = (await d.moduleEvents.toArray()).find((e) => e.kind === 'onboarded');
    expect(anchor).toMatchObject({ date: '2026-10-19', progressAt: '2026-10-25T22:00:00.000Z' });
    expect(await ensureProgressOpened(d, new Date('2026-10-25T23:59:59+02:00'))).toBe(false);
    expect(await Promise.all([ensureProgressOpened(d, new Date('2026-11-02T12:00:00+02:00')), ensureProgressOpened(d, new Date('2026-11-02T12:00:00+02:00'))])).toEqual([true, false]);
    expect((await d.moduleEvents.toArray()).filter((e) => e.kind === 'module' && e.source === 'automatic')).toHaveLength(1);
    expect(modulePreferences(await d.moduleEvents.toArray()).modules.progress).toBe(true);
  });
  it('honours a manual off before and after day eight; reset plan dates do not move the immutable anchor', async () => {
    const d = await fresh(); await finishModuleOnboarding(d, {}, start);
    await d.plan.update('main', { onboardedAt: '2026-11-01' }); // a whole-plan legacy client/restore
    await setModuleEnabled(d, 'progress', false, 'manual', '2026-10-20T00:00:00.000Z');
    expect(await ensureProgressOpened(d, new Date('2026-11-03T12:00:00Z'))).toBe(false);
    const events = await d.moduleEvents.toArray();
    expect(progressOpening(events, new Date('2026-11-03T12:00:00Z'))).toBeUndefined();
    const restored = await fresh(); await importAll(parseExport(JSON.stringify(await exportAll(d))), restored);
    expect(await ensureProgressOpened(restored, new Date('2026-11-03T12:00:00Z'))).toBe(false);
    expect(modulePreferences(await restored.moduleEvents.toArray()).modules.progress).toBe(false);
  });
  it('merges an unseen older manual off with a later automatic on consistently in encrypted sync and push policy', async () => {
    const a = await fresh(), b = await fresh(); await finishModuleOnboarding(a, {}, start);
    const records = new Map<string, RemoteRecord>(); let seq = 0;
    const api: Api = { async pull(since) { return { records: [...records.values()].filter((r) => r.seq > since), more: false, seq }; },
      async push(rows) { for (const r of rows) records.set(r.k, { ...r, seq: ++seq }); return { seq }; } };
    const code = newCode(), keys = await deriveKeys(parseCode(code)!);
    for (const d of [a, b]) await d.meta.put({ key: 'sync', code, seq: 0 });
    await syncOnce(a, keys, api, 1000); await syncOnce(b, keys, api, 1100);
    await setModuleEnabled(a, 'progress', false, 'manual', '2026-10-20T10:00:00.000Z');
    expect(await ensureProgressOpened(b, new Date('2026-10-27T12:00:00Z'))).toBe(true);
    await syncOnce(b, keys, api, 2000); await syncOnce(a, keys, api, 3000); await syncOnce(b, keys, api, 4000);
    for (const d of [a, b]) {
      const events = await d.moduleEvents.toArray(); expect(moduleChoiceAt(events, 'progress')?.enabled).toBe(false);
      expect(policyFromEvents(events).modules.progress).toMatchObject({ enabled: false, priority: 2 });
      expect(events.filter((e) => e.kind === 'onboarded')).toHaveLength(1);
    }
  });
  it('validates the new closed anchor vocabulary and produces a stable automatic id/content', () => {
    const anchor = onboardingAnchor('anchor', start);
    expect(isModuleEvent(anchor)).toBe(true);
    for (const bad of [{ ...anchor, progressAt: anchor.at }, { ...anchor, progressAt: 'bad' }, { ...anchor, date: '1900-01-01' },
      { ...anchor, text: 'extra' }, { id: 'start', v: 1, at: start.toISOString(), kind: 'onboarding-started', enabled: true }]) expect(isModuleEvent(bad)).toBe(false);
    const events: ModuleEvent[] = [anchor, { id: 'p', v: 1, at: start.toISOString(), kind: 'module', module: 'progress', source: 'onboarding', enabled: false }];
    expect(progressOpening(events, new Date('2026-10-27T12:00:00Z'))).toEqual(progressOpening(events, new Date('2026-11-03T15:00:00Z')));
  });
});

it('offers only changed positive confirmed plan evidence and applies only the explicitly selected scopes', async () => {
  const d = await fresh(); await finishModuleOnboarding(d, { patch: { prescriptions: [med()] } }, start);
  await setWeightEnabled(d, false, 'manual', '2026-10-20T10:00:00.000Z');
  const before = empty(), after: Plan = { ...empty(), constraints: [diet], targets: { waterMl: 2000, weightGoalKg: 90 },
    prescriptions: [{ id: 'free', kind: 'lifestyle', title: 'Ходьба і силові', source: '' }] };
  const events = await d.moduleEvents.toArray();
  expect(planModuleSuggestions(before, after, events).sort()).toEqual(['food', 'water', 'weight']);
  expect(planModuleSuggestions(after, after, events)).toEqual([]);
  await acceptPlanModules(d, ['water'], '2026-10-21T10:00:00.000Z');
  expect(modulePreferences(await d.moduleEvents.toArray())).toMatchObject({ modules: { water: true, food: false, workout: false }, overrides: { 'wellbeing.weight': false } });
  expect((await d.moduleEvents.toArray()).some((e) => e.kind === 'module' && e.module === 'water' && e.source === 'plan-review')).toBe(true);
});
