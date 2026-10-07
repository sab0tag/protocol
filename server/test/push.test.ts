import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { tick, vapidKeys, type Sender } from '../src/push.ts';
import { Store } from '../src/store.ts';

const VAULT = 'a'.repeat(32), AUTH = 'k'.repeat(43), DEV = 'd'.repeat(32), DEV2 = 'e'.repeat(32);
const SUB = { endpoint: 'https://push.example/abc', keys: { p256dh: 'BPk', auth: 'xyz' } };
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
    expect((await call('PUT', `/v1/vaults/${VAULT}/devices/${DEV}`, { subscription: { endpoint: 'http://x', keys: SUB.keys } })).status).toBe(400);
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

  it('VAPID keys are made once and kept', () => {
    const store = new Store(':memory:');
    const a = vapidKeys(store, {}), b = vapidKeys(store, {});
    expect(a).toEqual(b);
    expect(a.publicKey.length).toBeGreaterThan(80);
  });
});
