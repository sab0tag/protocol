import { describe, expect, it } from 'vitest';
import { emptyPolicy, mergeReminderPolicy, parseReminderPolicy, policyAccess, policyFromEvents, reminderAllowed, type DayRule, type ReminderPolicy } from '../../server/src/reminderPolicy';
import { DEFAULT_REMINDERS, reminders } from '../../src/domain/reminders';
import { MODULE_IDS } from '../../src/domain/features';
import type { ModuleEvent } from '../../src/domain/modulePreferences';
import type { DayEntry, Plan } from '../../src/domain/types';

const stamp = (enabled: boolean, at = '2026-10-20T10:00:00') => ({ id: 'choice', at: new Date(at).getTime(), priority: 1 as const, enabled });
const now = new Date('2026-10-25T12:00:00'); // a 25-hour local day
const plan: Plan = { prescriptions: [{ id: 'p', kind: 'medication', title: 'Private medicine', source: '', schedule: { times: ['13:00'] } }],
  constraints: [], targets: {}, modes: [] };
const entry: DayEntry = { id: 'meal', kind: 'meal', title: 'Private meal', status: 'planned', at: '2026-10-25T13:00:00+02:00' };
const light: DayRule = { ...stamp(true), date: '2026-10-25', from: new Date('2026-10-25T00:00:00').getTime(), until: new Date('2026-10-26T00:00:00').getTime() };
const generate = (policy?: ReminderPolicy, extra = {}) => reminders({ entries: [entry], plan, settings: { ...DEFAULT_REMINDERS, waterEveryH: 3, waterIfBehind: false },
  now, days: 2, topupAt: '18:00', ...(policy ? { policy } : {}), ...extra });

describe('module reminder policy (D136)', () => {
  it('keeps compatibility unchanged when no policy is passed and sends only generic words in the new mode', () => {
    expect(generate().items.find((i) => i.payload.k === 'meal')?.payload.t).toBe('Private meal');
    expect(JSON.stringify(generate(emptyPolicy()).items)).not.toContain('Private');
    expect(generate().items.map((i) => i.key)).toEqual(generate(emptyPolicy()).items.map((i) => i.key));
  });

  it('applies an explicit owner to every reminder kind, preserving always-on labs/visits', () => {
    const p: ReminderPolicy = { v: 1, modules: Object.fromEntries(MODULE_IDS.map((m) => [m, stamp(false)])), days: [] };
    for (const k of ['meal', 'med', 'water', 'morning', 'evening', 'topup', 'week', 'weight']) expect(reminderAllowed(p, { k }, +now)).toBe(false);
    for (const k of ['test', 'visit']) expect(reminderAllowed(p, { k }, +now)).toBe(true);
    expect(reminderAllowed(p, { k: 'unknown' }, +now)).toBe(false);
  });

  it('filters a morning summary instead of removing medication reminders with food', () => {
    const p: ReminderPolicy = { ...emptyPolicy(), modules: { food: stamp(false) } };
    expect(reminderAllowed(p, { k: 'morning' }, +now)).toBe(true);
    expect(policyAccess(p, +now)).toMatchObject({ meds: true, food: false });
    expect(reminderAllowed(p, { k: 'morning' }, +now, +now, false)).toBe(false); // old worker cannot filter
  });

  it('requires menu for menu-proposed meals and all owners of the topup CTA', () => {
    const menuOff = { ...emptyPolicy(), modules: { menu: stamp(false) } };
    expect(reminderAllowed(menuOff, { k: 'meal' }, +now)).toBe(true);
    expect(reminderAllowed(menuOff, { k: 'meal', m: true }, +now)).toBe(false);
    for (const g of ['food', 'menu', 'assistant']) expect(reminderAllowed({ ...emptyPolicy(), modules: { [g]: stamp(false) } }, { k: 'topup' }, +now)).toBe(false);
  });

  it('uses the independent weight override, not progress or wellbeing', () => {
    const p = { ...emptyPolicy(), modules: { wellbeing: stamp(false), progress: stamp(false), weight: stamp(true) } };
    expect(reminderAllowed(p, { k: 'weight' }, +now)).toBe(true);
    expect(reminderAllowed({ ...p, modules: { wellbeing: stamp(true), weight: stamp(false) } }, { k: 'weight' }, +now)).toBe(false);
  });

  it('merges stale devices deterministically, with explicit choices outranking a later migration', () => {
    const off = { ...emptyPolicy(), modules: { water: stamp(false) } };
    const migration = { ...emptyPolicy(), modules: { water: { ...stamp(true, '2026-10-25T11:00:00'), priority: 0 as const } } };
    expect(mergeReminderPolicy(off, migration).modules.water?.enabled).toBe(false);
    expect(mergeReminderPolicy(migration, off)).toEqual(mergeReminderPolicy(off, migration));
    const on = { ...off, modules: { water: { ...stamp(true), id: 'z' } } };
    expect(mergeReminderPolicy(off, on).modules.water?.enabled).toBe(true);
    expect(mergeReminderPolicy(off, emptyPolicy())).toEqual(off);
  });

  it('projects only module/weight decisions, retaining their exact LWW order and no medical content', () => {
    const events: ModuleEvent[] = [{ id: 'off', v: 1, kind: 'module', at: '2026-10-20T10:00:00.000Z', module: 'water', source: 'manual', enabled: false },
      { id: 'later-migration', v: 1, kind: 'module', at: '2026-10-25T10:00:00.000Z', module: 'water', source: 'migration', reason: 'records', before: 'unknown', enabled: true },
      { id: 'light', v: 1, kind: 'light-day', date: '2026-10-25', at: '2026-10-25T10:00:00.000Z', source: 'manual', enabled: true }];
    expect(policyFromEvents(events)).toMatchObject({ modules: { water: { enabled: false, id: 'off' } }, days: [] });
    expect(policyFromEvents([...events].reverse())).toEqual(policyFromEvents(events));
  });

  it('cancels water snoozes without acknowledging the disabled task or touching the medicine keys', () => {
    const key = 'water:2026-10-25:15:00';
    const baseline = generate(emptyPolicy(), { snoozed: { [key]: +now + 4 * 3_600_000 } });
    expect(baseline.items.some((i) => i.key.startsWith(`snooze:${key}`))).toBe(true);
    const off = generate({ ...emptyPolicy(), modules: { water: stamp(false) } }, { snoozed: { [key]: +now + 4 * 3_600_000 } });
    expect(off.items.some((i) => i.payload.k === 'water')).toBe(false);
    expect(off.done).not.toContain(key);
    expect(off.items.filter((i) => i.payload.k === 'med')).toEqual(baseline.items.filter((i) => i.payload.k === 'med'));
  });

  it('does not revive pre-activation reminders when a module is re-enabled', () => {
    const p = { ...emptyPolicy(), modules: { water: stamp(true, '2026-10-25T12:00:00') } };
    expect(reminderAllowed(p, { k: 'water' }, new Date('2026-10-25T11:00:00').getTime(), +now)).toBe(false);
    expect(reminderAllowed(p, { k: 'water' }, new Date('2026-10-25T15:00:00').getTime(), +now)).toBe(true);
  });

  it('ends a 25-hour light window at the next local midnight without dropping tomorrow from the schedule', () => {
    expect(light.until - light.from).toBe(25 * 3_600_000);
    const p = { ...emptyPolicy(), days: [light] };
    const out = generate(p);
    expect(out.items.filter((i) => i.payload.k === 'water').every((i) => i.at >= light.until)).toBe(true);
    expect(out.items.some((i) => i.payload.k === 'water' && i.payload.d === '2026-10-26')).toBe(true);
    expect(out.items.some((i) => i.payload.k === 'med' && i.at < light.until)).toBe(true);
    expect(reminderAllowed(p, { k: 'water' }, light.until, light.until)).toBe(true);
    expect(reminderAllowed(p, { k: 'water', o: light.from + 12 * 3_600_000 }, light.until + 60_000, light.until)).toBe(false);
    expect(reminderAllowed(p, { k: 'meal', u: './#/?date=2026-10-25' }, light.until + 60_000, light.until, false)).toBe(false);
    expect(reminderAllowed(p, { k: 'water' }, light.from - 60_000, +now)).toBe(false); // yesterday's repeat, today
  });

  it('allows a later cancellation of a synthetic light day and keeps its tombstone against stale devices', () => {
    const a = { ...emptyPolicy(), days: [light] }, b = { ...emptyPolicy(), days: [{ ...light, id: 'z', enabled: false }] };
    expect(mergeReminderPolicy(mergeReminderPolicy(a, b), a)).toEqual(b);
  });

  it('rejects unknown versions, gates, extra text, invalid windows and oversized/duplicate days', () => {
    const good = { ...emptyPolicy(), modules: { water: stamp(false) }, days: [light] };
    expect(parseReminderPolicy(good)).toEqual(good);
    for (const bad of [{ ...good, v: 2 }, { ...good, text: 'private' }, { ...good, modules: { typo: stamp(true) } },
      { ...good, modules: { water: { ...stamp(false), priority: 0 } } }, { ...good, days: [light, light] },
      { ...good, days: Array(41).fill(light) }, { ...good, days: [{ ...light, until: light.from }] },
      { ...good, days: [{ ...light, date: '2026-02-30' }] }, { ...good, modules: { water: { ...stamp(true), at: Infinity } } }]) expect(parseReminderPolicy(bad)).toBeUndefined();
  });
});
