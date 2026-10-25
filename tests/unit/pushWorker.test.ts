import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import source from '../../public/push-sw.js?raw';
import * as policy from '../../server/src/reminderPolicy';
import { ProtocolDB } from '../../src/data/db';
import type { ModuleId } from '../../src/domain/features';

let db: ProtocolDB;
beforeEach(async () => {
  db = new ProtocolDB('protocol');
  await db.plan.put({ id: 'main', constraints: [], modes: [], targets: { waterMl: 2000 }, prescriptions: [
    { id: 'm', kind: 'medication', title: 'Private medicine', dose: '1 tab', source: '', schedule: { times: ['08:30'] } }] });
  await db.entries.put({ id: 'meal', kind: 'meal', at: '2026-10-25T12:00:00', title: 'Private meal', status: 'planned', items: [{ name: 'Private food', grams: 100 }] });
});
afterEach(async () => { await db.delete(); });
const toggle = (module: ModuleId, enabled: boolean) => db.moduleEvents.put({ id: `${module}-${enabled}`, v: 1, at: '2026-01-01T00:00:00.000Z',
  kind: 'module', module, enabled, source: 'manual' });

/** Execute the actual classic worker against IndexedDB, awaiting its real waitUntil work. No OS notification dependency. */
function worker(enabled = true) {
  type Notification = { title: string; body: string; data: { reminder: Record<string, unknown> }; close: () => void };
  const shown: Notification[] = [];
  const handlers = new Map<string, (event: unknown) => void>();
  const self = { PROTOCOL_MODULE_POLICY_ENABLED: enabled, ProtocolReminderPolicy: policy,
    addEventListener: (kind: string, cb: (event: unknown) => void) => handlers.set(kind, cb),
    registration: { getNotifications: async () => [...shown], showNotification: async (title: string, options: Omit<Notification, 'title' | 'close'>) => {
      const n: Notification = { title, ...options, close: () => { const i = shown.indexOf(n); if (i >= 0) shown.splice(i, 1); } }; shown.push(n);
    } } };
  new Function('self', 'indexedDB', 'IDBKeyRange', source)(self, indexedDB, IDBKeyRange);
  const fire = async (kind: string, data: unknown) => {
    const waits: Promise<unknown>[] = [];
    handlers.get(kind)?.({ data: kind === 'push' ? { json: () => data } : data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { shown, push: (d: object) => fire('push', { t: 'Reminder', b: 'Generic', d: '2026-10-25', a: Date.now(), ...d }),
    changed: () => fire('message', { type: 'reminder-policy-changed' }) };
}

describe('worker re-checks local and server policy (D136)', () => {
  it('suppresses disabled water offline, without a pilot tally, while medication repeats and labs continue', async () => {
    await toggle('water', false);
    const w = worker();
    await w.push({ k: 'water', n: 0 });
    expect(w.shown).toHaveLength(0);
    expect(await db.tally.count()).toBe(0);
    await w.push({ k: 'med', h: '08:30', n: 1 });
    expect(w.shown[0]?.body).toContain('Private medicine');
    expect(w.shown[0]?.title).toContain('Ще раз');
    await w.push({ k: 'test', tag: 'lab', n: 0 });
    expect(w.shown).toHaveLength(2);
  });

  it('filters a morning summary to enabled actions and suppresses an empty summary', async () => {
    await toggle('food', false);
    const w = worker();
    await w.push({ k: 'morning' });
    expect(w.shown[0]?.body).toBe('ліки: 08:30');
    expect(JSON.stringify(w.shown)).not.toContain('Private meal');
    await toggle('meds', false);
    await w.push({ k: 'morning' });
    expect(w.shown).toHaveLength(1);
  });

  it('requires both local and server permission before showing a module notification', async () => {
    const w = worker();
    await w.push({ k: 'water', pv: 1, pa: { water: false } });
    expect(w.shown).toHaveLength(0); // another device disabled it, encrypted events have not arrived here yet
    await toggle('water', false);
    await w.push({ k: 'water', pv: 1, pa: { water: true } });
    expect(w.shown).toHaveLength(0); // local offline choice beats an already-in-flight push
  });

  it('closes a displayed water notification after offline off, retaining medication notifications', async () => {
    const w = worker();
    await w.push({ k: 'water' });
    await w.push({ k: 'med', h: '08:30' });
    expect(w.shown).toHaveLength(2);
    await toggle('water', false);
    await w.changed();
    expect(w.shown.map((n) => n.data.reminder.k)).toEqual(['med']);
  });

  it('uses the real report for weekly denominators and keeps server restrictions during a flag rollback', async () => {
    const w = worker();
    await w.push({ k: 'week' });
    expect(w.shown[0]?.body).toContain('періоди спостереження');
    expect(w.shown[0]?.body).not.toContain('з 7');
    const rollback = worker(false);
    await rollback.push({ k: 'water', pv: 1, pa: { water: false } });
    expect(rollback.shown).toHaveLength(0);
    await rollback.push({ k: 'water' }); // untouched compatibility build without a governing server policy
    expect(rollback.shown).toHaveLength(1);
  });
});
