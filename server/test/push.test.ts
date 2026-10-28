import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { tick, vapidKeys, type Sender } from '../src/push.ts';
import { Store } from '../src/store.ts';
import { emptyPolicy, type ReminderPolicy } from '../src/reminderPolicy.ts';

const VAULT = 'a'.repeat(32), AUTH = 'k'.repeat(43), DEV = 'd'.repeat(32), DEV2 = 'e'.repeat(32);
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BPk', auth: 'xyz' } };
const rid = (s: string) => s.padEnd(20, '_');
const T0 = Date.parse('2026-10-08T10:00:00Z');

function setup() {
  const store = new Store(':memory:');
  const sent: { sub: string; payload: Record<string, unknown> }[] = [];
  let result: 'ok' | 'gone' | 'error' = 'ok';
  const send: Sender = async (sub, payload) => { sent.push({ sub, payload: JSON.parse(payload) }); return result; };
  let now = T0;
  const app = createApp({ store, origins: [], push: { publicKey: 'PUB', send }, now: () => new Date(now) });
  const call = (method: string, path: string, body?: unknown) => app.request(path, { method,
    headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { store, sent, send, call, at: (t: number) => { now = t; }, fail: (r: typeof result) => { result = r; } };
}

const schedule = (items: { rid: string; at: number; t?: string }[], extra: Record<string, unknown> = {}) =>
  ({ items: items.map((i) => ({ rid: i.rid, at: i.at, payload: { t: i.t ?? 'Обід', b: 'Час їсти', k: 'meal' } })), repeatEvery: 15, repeats: 2, ...extra });

describe('push', () => {
  it('key, subscribe, a reminder at its time, repeats until ticked anywhere', async () => {
    const { store, sent, send, call } = setup();
    expect(await (await call('GET', '/v1/push/key')).json()).toEqual({ key: 'PUB' });
    await call('PUT', `/v1/vaults/${VAULT}`);
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://169.254.169.254/latest', 'https://fcm.googleapis.com:8443/x',
      'https://fcm.googleapis.com.evil.example/x']) {
      expect((await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}`, { subscription: { endpoint, keys: SUB.keys } })).status).toBe(400);
    }
    for (const endpoint of ['https://web.push.apple.com/QO', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-db5p.notify.windows.com/w/?token=x']) {
      expect((await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV2}`, { subscription: { endpoint, keys: SUB.keys } })).status).toBe(200);
    }
    expect((await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}`, { subscription: SUB })).status).toBe(200);
    await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}`, { subscription: SUB });
    expect((await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}/reminders`, schedule([{ rid: rid('lunch'), at: T0 + 60_000 }]))).status).toBe(200);

    expect(await tick(store, send, T0)).toBe(0);
    expect(await tick(store, send, T0 + 60_000)).toBe(1);
    expect(sent[0]!.payload).toEqual({ t: 'Обід', b: 'Час їсти', k: 'meal', n: 0 });
    expect(await tick(store, send, T0 + 120_000)).toBe(0); // the repeat is 15 min later
    expect(await tick(store, send, T0 + 16 * 60_000)).toBe(1);
    expect(sent[1]!.payload.n).toBe(1);
    // ticked on another device: its schedule says done → no third time here
    await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV2}`, { subscription: SUB });
    await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV2}/reminders`, schedule([], { done: [rid('lunch')] }));
    expect(await tick(store, send, T0 + 40 * 60_000)).toBe(0);
  });

  it('a new schedule keeps progress, moves changed times, drops what is gone; past new items are not sent late', async () => {
    const { store, sent, send, call } = setup();
    await call('PUT', `/v1/vaults/${VAULT}`);
    await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}`, { subscription: SUB });
    await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}/reminders`, schedule([{ rid: rid('a'), at: T0 }, { rid: rid('b'), at: T0 + 3600_000 }]));
    await tick(store, send, T0); // a sent once
    await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}/reminders`, schedule([
      { rid: rid('a'), at: T0 }, { rid: rid('b'), at: T0 + 7200_000 }, { rid: rid('old'), at: T0 - 600_000 }]));
    expect(await tick(store, send, T0 + 60_000)).toBe(0); // not 'a' again (its repeat is at +15 min), not 'old'
    expect(await tick(store, send, T0 + 3600_000 + 15 * 60_000)).toBe(1); // a's 2nd at +15 min; b moved to +2 h
    expect(sent.map((s) => s.payload.n)).toEqual([0, 1]);
    expect(await tick(store, send, T0 + 7200_000)).toBe(2); // b at its new time + a's last repeat (2 repeats = 3 times)
    expect(sent.map((s) => s.payload.n)).toEqual([0, 1, 2, 0]);
    expect(await tick(store, send, T0 + 9000_000)).toBe(1); // b's first repeat; a is done with
  });

  it('a gone subscription removes the device; the test push; vault isolation', async () => {
    const { store, sent, send, call, fail } = setup();
    await call('PUT', `/v1/vaults/${VAULT}`);
    expect((await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}/reminders`, schedule([]))).status).toBe(404);
    await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}`, { subscription: SUB });
    expect((await call('POST', `/v1/vaults/${VAULT}/devices/${DEV}/test`)).status).toBe(200);
    expect(sent[0]!.payload.k).toBe('test');
    await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}/reminders`, schedule([{ rid: rid('x'), at: T0 }]));
    fail('gone');
    await tick(store, send, T0);
    expect(store.hasDevice(VAULT, DEV)).toBe(false);
  });

  it('«once» items are never repeated', async () => {
    const { store, send, call } = setup();
    await call('PUT', `/v1/vaults/${VAULT}`);
    await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}`, { subscription: SUB });
    await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}/reminders`, { items: [{ rid: rid('morning'), at: T0, once: true, payload: { t: 'План', k: 'morning' } }], repeatEvery: 15, repeats: 2 });
    expect(await tick(store, send, T0)).toBe(1);
    expect(await tick(store, send, T0 + 20 * 60_000)).toBe(0);
  });

  it('VAPID keys are made once and kept', () => {
    const store = new Store(':memory:');
    const a = vapidKeys(store, {}), b = vapidKeys(store, {});
    expect(a).toEqual(b);
    expect(a.publicKey.length).toBeGreaterThan(80);
  });
});

describe('vault reminder reconciliation (D136)', () => {
  const choice = (enabled: boolean, at = T0 - 60_000, priority: 0 | 1 = 1) => ({ id: `choice-${at}`, at, priority, enabled });
  const waterOff = (): ReminderPolicy => ({ ...emptyPolicy(), modules: { water: choice(false) } });
  const path = (dev: string) => `/v1/vaults/${VAULT}/devices/${dev}/reminders`;
  const policyPath = `/v1/vaults/${VAULT}/reminder-policy`;
  const items = (at = T0) => ({ items: ['med', 'water'].map((k) => ({ rid: rid(k), at, payload: { k, t: k } })), repeatEvery: 15, repeats: 2, policyVersion: 1 });
  async function devices() {
    const s = setup();
    await s.call('PUT', `/v1/vaults/${VAULT}`);
    for (const d of [DEV, DEV2]) await s.call('PUT', `/v1/vaults/${VAULT}/devices/${d}`, { subscription: SUB });
    return s;
  }

  it('accepts policy without a subscription and prevents a stale legacy device from restoring water', async () => {
    const { store, call, send, sent } = setup();
    await call('PUT', `/v1/vaults/${VAULT}`);
    expect((await call('PUT', policyPath, waterOff())).status).toBe(200); // originating device has no push
    await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV2}`, { subscription: SUB });
    const { policyVersion: _, ...legacy } = items(); void _;
    await call('PUT', path(DEV2), legacy);
    await tick(store, send, T0);
    expect(sent.map((s) => s.payload.k)).toEqual(['med']);
  });

  it('cancels pending water, repeats and snooze across devices while preserving the medicine repeat count', async () => {
    const { store, call, send, sent } = await devices();
    for (const d of [DEV, DEV2]) await call('PUT', path(d), items());
    expect(await tick(store, send, T0)).toBe(4);
    const snooze = { rid: rid('snoozed-water'), at: T0 + 900_000, payload: { k: 'water' } };
    await call('PUT', path(DEV2), { ...items(), items: [...items().items, snooze] });
    await call('PUT', policyPath, waterOff());
    expect(store.all<{ payload: string }>('SELECT payload FROM reminders').every((r) => JSON.parse(r.payload).k === 'med')).toBe(true);
    // A stale schedule and even a newer migration cannot re-enable an explicit off.
    await call('PUT', policyPath, { ...emptyPolicy(), modules: { water: choice(true, T0 + 1, 0) } });
    await call('PUT', path(DEV2), { ...items(), items: [...items().items, snooze] });
    expect(await tick(store, send, T0 + 900_000)).toBe(2);
    expect(sent.slice(4).map((s) => [s.payload.k, s.payload.n])).toEqual([['med', 1], ['med', 1]]);
    expect(store.all('SELECT * FROM acks')).toHaveLength(0); // suppression is not taking a medicine or completing water
  });

  it('does not send old water in a burst after re-enabling, but resumes future slots', async () => {
    const { store, call, send, sent, at } = await devices();
    await call('PUT', path(DEV), items());
    await call('PUT', policyPath, waterOff());
    at(T0 + 600_000);
    await call('PUT', policyPath, { ...emptyPolicy(), modules: { water: choice(true, T0 + 600_000) } });
    await call('PUT', path(DEV2), { ...items(), items: [...items().items, { rid: rid('future-water'), at: T0 + 1200_000, payload: { k: 'water' } }] });
    await tick(store, send, T0 + 600_000);
    expect(sent.some((s) => s.payload.k === 'water')).toBe(false);
    await tick(store, send, T0 + 1200_000);
    expect(sent.filter((s) => s.payload.k === 'water')).toHaveLength(1);
  });

  it('keeps tomorrow in a preloaded schedule and expires a light window at midnight without a client request', async () => {
    const { store, call, send, sent } = await devices();
    const from = Date.parse('2026-10-08T00:00:00Z'), until = from + 86_400_000;
    const day = { ...choice(true), date: '2026-10-08', from, until };
    await call('PUT', path(DEV), { ...items(), items: [...items().items,
      { rid: rid('tomorrow-snoozed'), at: until + 60_000, payload: { k: 'water', o: T0 } },
      { rid: rid('tomorrow-water'), at: until + 60_000, payload: { k: 'water' } }] });
    expect((await call('PUT', policyPath, { ...emptyPolicy(), days: [day] })).status).toBe(200);
    await tick(store, send, T0);
    expect(sent.map((s) => s.payload.k)).toEqual(['med']);
    await tick(store, send, until + 60_000);
    expect(sent.filter((s) => s.payload.k === 'water')).toHaveLength(1);
  });

  it('re-checks policy between awaited sends from the same due snapshot', async () => {
    const { store, call, sent, send } = await devices();
    await call('PUT', path(DEV), items());
    let first = true;
    await tick(store, async (sub, payload) => {
      const result = await send(sub, payload);
      if (first) { first = false; store.setReminderPolicy(VAULT, waterOff(), T0); }
      return result;
    }, T0);
    expect(sent.map((s) => s.payload.k)).toEqual(['med']);
  });

  it('sends current restrictions to a modern worker before that device has pulled encrypted events', async () => {
    const { store, call, send, sent } = await devices();
    await call('PUT', policyPath, { ...emptyPolicy(), modules: { food: choice(false) } });
    await call('PUT', path(DEV), { ...items(), items: [{ rid: rid('morning'), at: T0, payload: { k: 'morning' } }] });
    await tick(store, send, T0);
    expect(sent[0]?.payload).toMatchObject({ pv: 1, a: T0, pa: { food: false, meds: true } });
    // The old worker would include disabled meals: suppress its indivisible morning summary.
    await call('PUT', path(DEV2), { items: [{ rid: rid('old-morning'), at: T0, payload: { k: 'morning' } }] });
    expect(await tick(store, send, T0)).toBe(0);
  });

  it('isolates policy by vault and retains it when a push subscription is dropped', async () => {
    const { store, call, send, sent } = await devices();
    await call('PUT', policyPath, waterOff());
    await call('DELETE', `/v1/vaults/${VAULT}/devices/${DEV}`);
    await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}`, { subscription: SUB });
    await call('PUT', path(DEV), items());
    const other = 'b'.repeat(32);
    await call('PUT', `/v1/vaults/${other}`);
    await call('PUT', `/v1/vaults/${other}/devices/${DEV}`, { subscription: SUB });
    await call('PUT', `/v1/vaults/${other}/devices/${DEV}/reminders`, items());
    await tick(store, send, T0);
    expect(sent.filter((s) => s.payload.k === 'water')).toHaveLength(1);
    expect(store.reminderPolicy(VAULT).modules.water?.enabled).toBe(false);
  });

  it('keeps a synced manual progress choice over a newer day-eight automatic choice, including stale schedules', async () => {
    const { store, call, send } = await devices();
    const automatic = { ...emptyPolicy(), modules: { progress: choice(true, T0) } };
    const manual = { ...emptyPolicy(), modules: { progress: { ...choice(false, T0 - 60_000), priority: 2 } } };
    const week = { items: [{ rid: rid('week'), at: T0, payload: { k: 'week' } }], policyVersion: 1 };
    expect((await call('PUT', policyPath, automatic)).status).toBe(200);
    await call('PUT', path(DEV), week);
    expect(store.all('SELECT * FROM reminders')).toHaveLength(1);
    expect((await call('PUT', policyPath, manual)).status).toBe(200);
    expect(store.all('SELECT * FROM reminders')).toHaveLength(0);
    await call('PUT', policyPath, automatic); await call('PUT', path(DEV2), week);
    expect(store.reminderPolicy(VAULT).modules.progress).toMatchObject({ enabled: false, priority: 2 });
    expect(await tick(store, send, T0)).toBe(0);
    expect((await call('PUT', policyPath, { ...emptyPolicy(), modules: { water: { ...choice(false), priority: 2 } } })).status).toBe(400);
    expect((await call('PUT', policyPath, { ...emptyPolicy(), modules: { progress: { ...choice(true, T0 + 1), priority: 2 } } })).status).toBe(200);
    await call('PUT', path(DEV), { ...week, items: [{ ...week.items[0], at: T0 + 1 }] });
    expect(await tick(store, send, T0 + 1)).toBe(1);
  });

  it('rejects malformed policies/schedules atomically and does not misreport unsupported versions', async () => {
    const { store, call } = await devices();
    for (const body of [{ ...waterOff(), v: 2 }, { ...waterOff(), modules: { arbitrary: choice(false) } },
      { ...waterOff(), days: [{ ...choice(true), date: '2030-01-01', from: Date.parse('2030-01-01T00:00:00Z'), until: Date.parse('2030-01-02T00:00:00Z') }] },
      { ...waterOff(), text: 'medical words' }, { ...waterOff(), modules: { water: { ...choice(false), priority: 0 } } }]) {
      expect((await call('PUT', policyPath, body)).status).toBe(400);
    }
    expect(store.reminderPolicy(VAULT)).toEqual(emptyPolicy());
    for (const body of [{ ...items(), policyVersion: 2 }, { ...items(), items: [null] },
      { ...items(), items: [{ rid: rid('bad'), at: null, payload: { k: 'water' } }] },
      { ...items(), items: [{ rid: rid('bad'), at: T0, payload: { k: 'unknown' } }] }]) {
      expect((await call('PUT', path(DEV), body)).status).toBe(400);
    }
    expect(store.all('SELECT * FROM reminders')).toHaveLength(0);
  });
});
