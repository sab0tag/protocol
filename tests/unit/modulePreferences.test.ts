import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { ProtocolDB, ensureSeeded } from '../../src/data/db';
import { appendModuleEvents, initialiseModulePreferences, legacyModuleUsage, setLightDay, setModuleEnabled, setWeightEnabled } from '../../src/data/modulePreferences';
import { exportAll, importAll, parseExport } from '../../src/data/backup';
import { isLightDay, isModuleEvent, moduleChoiceAt, modulePreferences, type ModuleChoice, type ModuleEvent } from '../../src/domain/modulePreferences';
import { ALL_MODULES } from '../../src/domain/features';
import { deriveKeys, newCode, parseCode, recordKey, seal } from '../../src/sync/crypto';
import { syncOnce, type Api, type RemoteRecord } from '../../src/sync/engine';

const EARLY = '2026-10-01T08:00:00.000Z', LATER = '2026-10-25T08:00:00.000Z', NEXT = '2026-10-26T08:00:00.000Z';
const manual = (id: string, module: ModuleChoice['module'], enabled: boolean, at = LATER): ModuleChoice =>
  ({ id, v: 1, at, kind: 'module', module, enabled, source: 'manual' });
const baseline = (id: string, module: ModuleChoice['module'], at = EARLY): ModuleChoice =>
  ({ id, v: 1, at, kind: 'module', module, enabled: true, source: 'migration', reason: 'compatibility', before: 'unknown' });
let serial = 0;
const databases: ProtocolDB[] = [];
function fresh() { const d = new ProtocolDB(`module-prefs-${++serial}`); databases.push(d); return d; }
afterEach(async () => { for (const d of databases.splice(0)) { d.close(); await d.delete(); } });

describe('module history and validation (D134)', () => {
  it('resolves independent choices, neutral dates and a standalone weight override without mutating the input', () => {
    const events: ModuleEvent[] = [manual('food-off', 'food', false), manual('water-off', 'water', false),
      { id: 'weight', v: 1, at: LATER, kind: 'weight', enabled: true, source: 'manual' },
      { id: 'light', v: 1, at: LATER, kind: 'light-day', date: '2026-10-25', enabled: true, source: 'voice' }];
    const copy = JSON.stringify(events);
    expect(modulePreferences(events)).toEqual({ modules: { ...ALL_MODULES, food: false, water: false }, overrides: { 'wellbeing.weight': true } });
    expect(isLightDay(events, '2026-10-25')).toBe(true);
    expect(isLightDay(events, '2026-10-26')).toBe(false);
    expect(JSON.stringify(events)).toBe(copy);
  });

  it('never lets a fresh-device migration override an explicit choice, even with a later clock', () => {
    const events = [manual('choice', 'food', false, EARLY), baseline('new-device', 'food', NEXT)];
    expect(modulePreferences(events).modules.food).toBe(false);
    expect(modulePreferences([...events].reverse())).toEqual(modulePreferences(events));
  });

  it('uses event time and a stable id tie-break, not arrival order or string locale', () => {
    const events = [manual('a', 'food', true), manual('b', 'food', false), manual('older', 'food', true, EARLY)];
    expect(modulePreferences(events).modules.food).toBe(false);
    expect(modulePreferences([...events].reverse()).modules.food).toBe(false);
    expect(moduleChoiceAt(events, 'food', EARLY)?.enabled).toBe(true);
  });

  it('does not invent a first-use date before migration; repeated on/off intervals remain in history', () => {
    const events = [baseline('migration', 'food'), manual('off', 'food', false), manual('on', 'food', true, NEXT)];
    expect(moduleChoiceAt(events, 'food', '2026-09-30T23:59:59.999Z')).toBeUndefined();
    expect(moduleChoiceAt(events, 'food', EARLY)).toMatchObject({ source: 'migration', before: 'unknown' });
    expect(moduleChoiceAt(events, 'food', LATER)?.enabled).toBe(false);
    expect(moduleChoiceAt(events, 'food', NEXT)?.enabled).toBe(true);
  });

  it('accepts only complete versioned events with real dates and closed values', () => {
    const event = manual('valid', 'food', false);
    expect(isModuleEvent(event)).toBe(true);
    const bad = [null, [], { ...event, id: '' }, { ...event, v: 2 }, { ...event, at: '2026-02-30T08:00:00.000Z' },
      { ...event, at: '2026-10-25T08:00:00+02:00' }, { ...event, module: '__proto__' }, { ...event, enabled: 'false' },
      { ...event, source: 'unknown' }, { ...event, text: 'unexpected data' }, { ...event, source: 'migration' },
      { ...baseline('bad-migration', 'food'), enabled: false }, { ...event, source: 'automatic' },
      { ...event, kind: 'light-day', date: '2026-02-30' }, Object.create(event),
      { id: 'bad', v: 1, at: LATER, kind: 'offer', module: 'food', offerId: 'o', action: { toString: 'yes' } }];
    for (const value of bad) expect(isModuleEvent(value), JSON.stringify(value)).toBe(false);
    expect(isModuleEvent({ ...event, module: 'progress', source: 'automatic', enabled: true })).toBe(true);
  });
});

describe('module storage and migration', () => {
  it('upgrades an actual v7 database without changing its plan or entries', async () => {
    const d = fresh();
    const old = new Dexie(d.name);
    // The v7 stores are the existing schema, not an empty database pretending to have version 7.
    old.version(7).stores({ plan: 'id', foods: 'id, name', entries: 'id, at, kind', wellbeing: 'date', workouts: 'id, date',
      weights: 'date', labs: '[date+name], name', recipes: 'id, name', favorites: 'id, title', frictions: 'id, at', pieces: 'id',
      tally: 'day', pilot: 'key', sync: 'tid', meta: 'key' });
    const plan = { id: 'main', prescriptions: [], constraints: [], targets: {}, modes: [] };
    await old.table('plan').put(plan);
    await old.table('entries').put({ id: 'water', at: EARLY, kind: 'water', status: 'done', title: 'Вода', waterMl: 250 });
    old.close();
    await d.open();
    await initialiseModulePreferences(d, LATER);
    expect(d.verno).toBe(10);
    expect(await d.profile.count()).toBe(0);
    expect(await d.reviewDrafts.count()).toBe(0);
    expect(await d.plan.get('main')).toEqual(plan);
    expect((await d.entries.get('water'))?.waterMl).toBe(250);
    expect(moduleChoiceAt(await d.moduleEvents.toArray(), 'water')).toMatchObject({ reason: 'records', before: 'unknown' });
  });

  it('preserves all old access, distinguishes evidence from built-ins and never repeats migration', async () => {
    const d = fresh(); await ensureSeeded(d);
    await d.entries.add({ id: 'meal', at: EARLY, kind: 'meal', title: 'Обід', status: 'done' });
    await d.workouts.add({ id: 'workout', date: '2026-10-01', durationMin: 10, equipment: '', exercises: [] });
    await d.plan.update('main', { prescriptions: [{ id: 'p', kind: 'medication', title: 'Ліки', source: '' }], targets: { waterMl: 2000 } });
    await initialiseModulePreferences(d, LATER, { assistant: true });
    const before = await d.moduleEvents.toArray();
    expect(modulePreferences(before).modules).toEqual(ALL_MODULES);
    expect(moduleChoiceAt(before, 'food')).toMatchObject({ reason: 'records' });
    expect(moduleChoiceAt(before, 'workout')).toMatchObject({ reason: 'records' });
    expect(moduleChoiceAt(before, 'meds')).toMatchObject({ reason: 'plan' });
    expect(moduleChoiceAt(before, 'water')).toMatchObject({ reason: 'plan' });
    expect(moduleChoiceAt(before, 'assistant')).toMatchObject({ reason: 'records' });
    expect(moduleChoiceAt(before, 'menu')).toMatchObject({ reason: 'compatibility' });
    await setModuleEnabled(d, 'food', false, 'manual', NEXT);
    await d.plan.update('main', { targets: { weightGoalKg: 90 } });
    await initialiseModulePreferences(d, NEXT);
    expect(await d.moduleEvents.count()).toBe(before.length + 1);
    expect(modulePreferences(await d.moduleEvents.toArray()).modules.food).toBe(false);
    expect(modulePreferences(await d.moduleEvents.toArray()).overrides).toEqual({}); // no late automatic weight activation
  });

  it('does not treat example records or built-in dishes as personal food use', async () => {
    const d = fresh(); await ensureSeeded(d);
    await d.entries.put({ id: 'demo', at: EARLY, kind: 'meal', title: 'Приклад', status: 'done', demo: true });
    await initialiseModulePreferences(d, LATER);
    expect(moduleChoiceAt(await d.moduleEvents.toArray(), 'food')).toMatchObject({ reason: 'compatibility' });
    expect(modulePreferences(await d.moduleEvents.toArray()).modules.food).toBe(true); // absence of evidence must not hide access
  });

  it('keeps choices and light-day history across restart; duplicate commands and retries are idempotent', async () => {
    const d = fresh(); await ensureSeeded(d); await initialiseModulePreferences(d, EARLY);
    await setModuleEnabled(d, 'food', false, 'manual', LATER);
    await setModuleEnabled(d, 'food', false, 'manual', NEXT);
    await setWeightEnabled(d, false, 'manual', LATER);
    await setLightDay(d, '2026-10-25', true, 'voice', LATER);
    await setLightDay(d, '2026-10-25', true, 'voice', NEXT);
    const events = await d.moduleEvents.toArray();
    await appendModuleEvents(d, [events[0]!]);
    expect(await d.moduleEvents.count()).toBe(events.length);
    d.close(); await d.open();
    expect(modulePreferences(await d.moduleEvents.toArray())).toMatchObject({ modules: { food: false }, overrides: { 'wellbeing.weight': false } });
    expect(isLightDay(await d.moduleEvents.toArray(), '2026-10-25')).toBe(true);
    await setLightDay(d, '2026-10-25', false, 'manual', NEXT);
    expect(isLightDay(await d.moduleEvents.toArray(), '2026-10-25')).toBe(false);
  });

  it('reads only presence of legacy personal drafts, without storing their words or mixing in demo', () => {
    localStorage.clear();
    localStorage.setItem('protocol.kept.assistant:2026-10-01', JSON.stringify({ at: 1, v: [{ text: 'private words' }] }));
    localStorage.setItem('protocol.kept.demo.menu', JSON.stringify({ at: 1, v: { drafts: [{}] } }));
    expect(legacyModuleUsage()).toEqual({ assistant: true });
    expect(legacyModuleUsage(true)).toEqual({ menu: true });
    localStorage.clear();
  });
});

describe('preference backups', () => {
  it('round-trips module choices, weight, offers and light days into an already bootstrapped device', async () => {
    const a = fresh(), b = fresh(); await ensureSeeded(a); await ensureSeeded(b);
    await initialiseModulePreferences(a, EARLY); await initialiseModulePreferences(b, NEXT);
    await setModuleEnabled(a, 'food', false, 'manual', LATER);
    await setWeightEnabled(a, true, 'manual', LATER);
    await setLightDay(a, '2026-10-25', true, 'voice', LATER);
    await appendModuleEvents(a, [{ id: 'offer-shown', v: 1, at: LATER, kind: 'offer', module: 'menu', offerId: 'o1', action: 'shown' },
      { id: 'offer-answer', v: 1, at: NEXT, kind: 'offer', module: 'menu', offerId: 'o1', action: 'later' }]);
    await a.pilot.put({ key: 'pilot', secret: 'local-only' });
    const file = parseExport(JSON.stringify(await exportAll(a)));
    expect(file.version).toBe(2);
    expect(JSON.stringify(file)).not.toContain('local-only');
    await importAll(file, b);
    expect(modulePreferences(await b.moduleEvents.toArray())).toEqual(modulePreferences(await a.moduleEvents.toArray()));
    expect(isLightDay(await b.moduleEvents.toArray(), '2026-10-25')).toBe(true);
    expect(await b.moduleEvents.get('offer-answer')).toMatchObject({ action: 'later' });
    await importAll(file, b);
    expect((await b.moduleEvents.toArray()).filter((e) => e.id === 'offer-answer')).toHaveLength(1);
  });

  it('keeps newer explicit local choices when an old v2 or a legacy v1 copy is restored', async () => {
    const d = fresh(); await ensureSeeded(d); await initialiseModulePreferences(d, EARLY);
    await setModuleEnabled(d, 'food', true, 'manual', EARLY);
    const old = await exportAll(d);
    await setModuleEnabled(d, 'food', false, 'manual', NEXT);
    await importAll(parseExport(JSON.stringify(old)), d);
    expect(modulePreferences(await d.moduleEvents.toArray()).modules.food).toBe(false);
    const { moduleEvents: _, ...legacy } = old;
    void _;
    await importAll(parseExport(JSON.stringify({ ...legacy, version: 1 })), d);
    expect(modulePreferences(await d.moduleEvents.toArray()).modules.food).toBe(false);
  });

  it('rejects unknown fields/modules, duplicate ids and invalid counts/dates before touching the diary', async () => {
    const d = fresh(); await ensureSeeded(d);
    const file = await exportAll(d), good = manual('one', 'food', false);
    for (const moduleEvents of [[{ ...good, module: 'unknown' }], [{ ...good, text: 'extra' }], [good, good], [{ ...good, enabled: 0 }],
      [{ id: 'bad', v: 1, at: LATER, kind: 'light-day', date: '2026-02-30', enabled: true, source: 'manual' }]]) {
      expect(() => parseExport(JSON.stringify({ ...file, moduleEvents }))).toThrow();
    }
    expect(() => parseExport(JSON.stringify({ ...file, moduleEvents: undefined }))).toThrow();
    expect(() => parseExport(JSON.stringify({ ...file, version: 1 }))).toThrow('формату');
  });

  it('rolls back the whole import if a reused immutable id conflicts', async () => {
    const d = fresh(); await ensureSeeded(d);
    await appendModuleEvents(d, [manual('collision', 'food', false)]);
    await d.entries.put({ id: 'keep', at: EARLY, title: 'Вода', kind: 'water', status: 'done', waterMl: 250 });
    const file = { ...await exportAll(d), entries: [], moduleEvents: [manual('collision', 'food', true)] };
    await expect(importAll(file, d)).rejects.toThrow('іншим вмістом');
    expect((await d.entries.get('keep'))?.waterMl).toBe(250);
    expect(modulePreferences(await d.moduleEvents.toArray()).modules.food).toBe(false);
  });
});

function fakeServer() {
  const records = new Map<string, RemoteRecord>(); let seq = 0;
  const api: Api = {
    async pull(since) { return { records: [...records.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq), more: false, seq }; },
    async push(rows) { for (const r of rows) records.set(r.k, { ...r, seq: ++seq }); return { seq }; },
  };
  return { api, records };
}

describe('encrypted module history sync', () => {
  async function devices() {
    const code = newCode(), keys = await deriveKeys(parseCode(code)!);
    const a = fresh(), b = fresh();
    for (const d of [a, b]) { await ensureSeeded(d); await d.meta.put({ key: 'sync', code, seq: 0 }); }
    return { a, b, keys, server: fakeServer() };
  }

  it('joins new-device migration with existing manual off and independent offline choices without losing either', async () => {
    const { a, b, keys, server } = await devices();
    await initialiseModulePreferences(a, EARLY); await setModuleEnabled(a, 'food', false, 'manual', LATER);
    await syncOnce(a, keys, server.api, 1000);
    await initialiseModulePreferences(b, NEXT); // a later migration must not turn food back on
    await setModuleEnabled(b, 'water', false, 'manual', NEXT);
    await syncOnce(b, keys, server.api, 2000); await syncOnce(a, keys, server.api, 3000);
    for (const d of [a, b]) expect(modulePreferences(await d.moduleEvents.toArray()).modules).toMatchObject({ food: false, water: false });
    await syncOnce(b, keys, server.api, 4000);
    expect(await syncOnce(a, keys, server.api, 5000)).toMatchObject({ pushed: 0 });
    expect(JSON.stringify([...server.records.values()])).not.toContain('"source":"manual"');
  });

  it('converges concurrent opposite choices by event time, retaining both events', async () => {
    const { a, b, keys, server } = await devices();
    await syncOnce(a, keys, server.api, 1000); await syncOnce(b, keys, server.api, 1100);
    await appendModuleEvents(a, [manual('a-choice', 'food', false, EARLY)]);
    await appendModuleEvents(b, [manual('b-choice', 'food', true, LATER)]);
    await syncOnce(b, keys, server.api, 2000); await syncOnce(a, keys, server.api, 3000); await syncOnce(b, keys, server.api, 4000);
    for (const d of [a, b]) {
      expect(modulePreferences(await d.moduleEvents.toArray()).modules.food).toBe(true);
      expect(await d.moduleEvents.get('a-choice')).toBeDefined(); expect(await d.moduleEvents.get('b-choice')).toBeDefined();
    }
  });

  it('keeps preferences outside the legacy whole plan and rejects deletions, rewrites and malformed encrypted events', async () => {
    const { a, b, keys, server } = await devices();
    const original = manual('keep-choice', 'food', false);
    await appendModuleEvents(a, [original]); await syncOnce(a, keys, server.api, 1000); await syncOnce(b, keys, server.api, 1100);
    const row = async (t: string, id: string, d: unknown, at: number) => { const k = await recordKey(keys, `${t}:${id}`); return { k, v: await seal(keys, k, { t, id, d, at }) }; };
    await server.api.push([await row('plan', 'main', { id: 'main', prescriptions: [], constraints: [], targets: {}, modes: [] }, 2000),
      await row('moduleEvents', 'keep-choice', null, 2000),
      await row('moduleEvents', 'unknown', { ...manual('unknown', 'food', true), module: 'unknown' }, 2000)]);
    await syncOnce(b, keys, server.api, 3000);
    expect(await b.moduleEvents.get('keep-choice')).toEqual(original);
    expect(await b.moduleEvents.get('unknown')).toBeUndefined();
    await server.api.push([await row('moduleEvents', 'keep-choice', { ...original, enabled: true }, 4000)]);
    await syncOnce(b, keys, server.api, 5000);
    expect(modulePreferences(await b.moduleEvents.toArray()).modules.food).toBe(false);
    const restored = fresh(); await ensureSeeded(restored);
    await restored.meta.put({ key: 'sync', code: (await a.meta.get('sync'))!.code, seq: 0 });
    await syncOnce(restored, keys, server.api, 6000);
    expect(modulePreferences(await restored.moduleEvents.toArray()).modules.food).toBe(false);
  });

  it('does not infer a deletion if local history is temporarily missing, and can recover it on a new pull', async () => {
    const { a, b, keys, server } = await devices();
    await appendModuleEvents(a, [manual('keep', 'food', false)]); await syncOnce(a, keys, server.api, 1000);
    await a.moduleEvents.clear(); // emulate a partial read/older restore, never a user-facing delete command
    expect((await syncOnce(a, keys, server.api, 2000)).pushed).toBe(0);
    await syncOnce(b, keys, server.api, 3000);
    expect(modulePreferences(await b.moduleEvents.toArray()).modules.food).toBe(false);
  });
});
