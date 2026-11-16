import { afterEach, describe, expect, it } from 'vitest';
import { ensureSeeded, ProtocolDB } from '../../src/data/db';
import { movedMeal, rescheduleMeal, undoMealSchedule } from '../../src/data/mealSchedule';
import { acceptPlan } from '../../src/domain/menu';
import { entryVisible } from '../../src/domain/visibility';
import { ALL_MODULES } from '../../src/domain/features';
import { observedPlannedEntry } from '../../src/domain/observation';
import type { DayEntry } from '../../src/domain/types';
import { deriveKeys, newCode, parseCode } from '../../src/sync/crypto';
import { syncOnce, type Api, type RemoteRecord } from '../../src/sync/engine';

const now = new Date('2026-11-04T12:00:00+02:00');
const before: DayEntry = { id: 'same-meal', kind: 'meal', status: 'planned', at: '2026-11-03T13:00:00+02:00', title: 'Тестовий обід',
  items: [{ name: 'Синтетична страва', grams: 200 }], menu: { tips: ['Тестова порада'] }, via: 'photo' };
const at = '2026-11-05T14:30:00+02:00';
const databases: ProtocolDB[] = [];
const database = () => { const d = new ProtocolDB('meal-schedule-' + crypto.randomUUID()); databases.push(d); return d; };
afterEach(async () => { for (const d of databases.splice(0)) await d.delete(); });

describe('explicit meal rescheduling', () => {
  it('moves the same planned meal with its source data and appends history without mutating the original', () => {
    const result = movedMeal(before, at, now);
    expect(result).toEqual({ ...before, at, scheduleChanges: [{ from: before.at, to: at, changedAt: now.toISOString() }] });
    expect(before.at).toBe('2026-11-03T13:00:00+02:00');
    expect(before.scheduleChanges).toBeUndefined();
    const second = movedMeal(result, '2026-11-06T15:00:00+02:00', now);
    expect(second.scheduleChanges).toHaveLength(2);
    expect(result.scheduleChanges).toHaveLength(1);
  });

  it.each(['2026-11-04T11:59:00+02:00', now.toISOString(), 'invalid'])('refuses a non-future or invalid destination: %s', target => {
    expect(() => movedMeal(before, target, now)).toThrow('not_future');
  });

  it.each(['done', 'skipped'] as const)('does not rewrite a recorded outcome: %s', status => {
    expect(() => movedMeal({ ...before, status }, at, now)).toThrow('not_planned');
  });

  it('does not reschedule medicine or accept the same scheduled instant', () => {
    expect(() => movedMeal({ ...before, kind: 'med' }, at, now)).toThrow('not_planned');
    expect(() => movedMeal({ ...before, at }, '2026-11-05T12:30:00Z', now)).toThrow('same_time');
  });

  it('clears legacy outcome fields when a returned-to-plan entry is moved', () => {
    const result = movedMeal({ ...before, skipReason: 'Old reason', markedAt: before.at, plannedAt: before.at,
      timeUnknown: true, adherence: 'uncertain' }, at, now);
    for (const key of ['skipReason', 'markedAt', 'plannedAt', 'timeUnknown', 'adherence']) expect(result).not.toHaveProperty(key);
  });

  it('updates IndexedDB atomically, changes the date index and creates no duplicate on double submission', async () => {
    const d = database(); await d.entries.put(before);
    const results = await Promise.allSettled([rescheduleMeal(d, before, at, now), rescheduleMeal(d, before, at, now)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await d.entries.count()).toBe(1);
    expect(await d.entries.where('at').startsWith('2026-11-03T').count()).toBe(0);
    expect(await d.entries.where('at').startsWith('2026-11-05T').count()).toBe(1);
    expect((await d.entries.get(before.id))?.scheduleChanges).toHaveLength(1);
  });

  it('rejects stale dialogs and leaves a newer outcome intact', async () => {
    const d = database(); const done = { ...before, status: 'done' as const }; await d.entries.put(done);
    await expect(rescheduleMeal(d, before, at, now)).rejects.toThrow('changed');
    expect(await d.entries.get(before.id)).toEqual(done);
  });

  it('undo restores the old date, metadata and history without making a second row', async () => {
    const d = database(); await d.entries.put(before);
    const change = await rescheduleMeal(d, before, at, now);
    await undoMealSchedule(d, change);
    expect(await d.entries.toArray()).toEqual([before]);
  });

  it('undo refuses to overwrite a subsequent edit or resurrect a deleted meal', async () => {
    const d = database(); await d.entries.put(before);
    const change = await rescheduleMeal(d, before, at, now);
    await d.entries.put({ ...change.after, title: 'Edited elsewhere' });
    await expect(undoMealSchedule(d, change)).rejects.toThrow('changed');
    expect((await d.entries.get(before.id))?.title).toBe('Edited elsewhere');
    await d.entries.delete(before.id);
    await expect(undoMealSchedule(d, change)).rejects.toThrow('changed');
    expect(await d.entries.count()).toBe(0);
  });

  it('keeps a deliberately moved menu meal when accepting a replacement menu, and visible when menu is disabled', () => {
    const moved = movedMeal(before, at, now);
    const result = acceptPlan({ date: '2026-11-05', meals: [], tips: [] }, [moved, { ...before, id: 'ordinary-proposal', at }], () => 'new', () => at);
    expect(result.remove).toEqual(['ordinary-proposal']);
    expect(entryVisible(moved, { modules: { ...ALL_MODULES, menu: false }, tier: 'free' })).toBe(true);
    expect(entryVisible(moved, { modules: { ...ALL_MODULES, food: false }, tier: 'free' })).toBe(false);
    const observation = { now, events: [
      { id: 'food-on', v: 1 as const, kind: 'module' as const, module: 'food' as const, enabled: true, source: 'manual' as const, at: '2026-11-01T00:00:00Z' },
      { id: 'menu-off', v: 1 as const, kind: 'module' as const, module: 'menu' as const, enabled: false, source: 'manual' as const, at: '2026-11-01T00:00:00Z' },
    ] };
    expect(observedPlannedEntry(observation, moved)).toBe(true);
    expect(observedPlannedEntry(observation, { ...before, at })).toBe(false);
  });

  it('syncs the move and its undo between two devices as one encrypted record with its history', async () => {
    const phone = database(), laptop = database(), code = newCode();
    await ensureSeeded(phone); await ensureSeeded(laptop);
    await phone.meta.put({ key: 'sync', code, seq: 0 }); await laptop.meta.put({ key: 'sync', code, seq: 0 });
    const keys = await deriveKeys(parseCode(code)!);
    const records = new Map<string, RemoteRecord>(); let seq = 0;
    const api: Api = {
      async pull(since) { const out = [...records.values()].filter(r => r.seq > since).sort((a, b) => a.seq - b.seq);
        return { records: out, more: false, seq: out.at(-1)?.seq ?? Math.max(since, seq) }; },
      async push(rows) { for (const row of rows) records.set(row.k, { ...row, seq: ++seq }); return { seq }; },
    };
    await phone.entries.put(before);
    await syncOnce(phone, keys, api, 1000); await syncOnce(laptop, keys, api, 2000);
    const change = await rescheduleMeal(phone, before, at, now);
    await syncOnce(phone, keys, api, 3000); await syncOnce(laptop, keys, api, 4000);
    expect(await laptop.entries.toArray()).toEqual([change.after]);
    expect([...records.values()].some(r => r.v?.includes('Синтетична страва'))).toBe(false);
    await undoMealSchedule(phone, change);
    await syncOnce(phone, keys, api, 5000); await syncOnce(laptop, keys, api, 6000);
    expect(await laptop.entries.toArray()).toEqual([before]);
  });
});
