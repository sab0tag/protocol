import { describe, expect, it } from 'vitest';
import { ensureSeeded, ProtocolDB } from '../../src/data/db';
import { deriveKeys, formatCode, newCode, open, parseCode, recordKey, seal } from '../../src/sync/crypto';
import { hashOf, syncOnce, type Api, type RemoteRecord } from '../../src/sync/engine';
import type { DayEntry } from '../../src/domain/types';

/** The server as the app sees it: opaque records with a growing seq. */
function fakeServer() {
  const records = new Map<string, RemoteRecord>();
  let seq = 0;
  const api: Api = {
    async pull(since) {
      const out = [...records.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      return { records: out, more: false, seq: out.at(-1)?.seq ?? Math.max(since, seq) };
    },
    async push(rs) {
      for (const r of rs) records.set(r.k, { k: r.k, v: r.v, seq: ++seq });
      return { seq };
    },
  };
  return { api, records };
}

let n = 0;
async function device(code: string) {
  const db = new ProtocolDB(`sync-test-${++n}`);
  await ensureSeeded(db);
  await db.meta.put({ key: 'sync', code, seq: 0 });
  return db;
}

const meal = (id: string, at: string, name: string): DayEntry =>
  ({ id, at, kind: 'meal', status: 'done', title: 'Обід', items: [{ name, grams: 100 }] });

describe('sync code', () => {
  it('round-trips and forgives case, spaces and look-alikes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const code = formatCode(bytes);
    expect(code).toMatch(/^([0-9A-Z]{4}-){6}[0-9A-Z]{2}$/);
    expect(parseCode(code)).toEqual(bytes);
    expect(parseCode(` ${code.toLowerCase().replace(/-/g, ' ')} `)).toEqual(bytes);
    expect(parseCode(code.replace(/0/g, 'O').replace(/1/g, 'l'))).toEqual(bytes);
    expect(parseCode('ABC')).toBeUndefined();
    expect(parseCode('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZ')).toBeUndefined(); // more than 128 bits
  });

  it('derives the same vault on every device; different codes — different vaults', async () => {
    const a = await deriveKeys(parseCode(newCode())!);
    const code = newCode();
    const b1 = await deriveKeys(parseCode(code)!), b2 = await deriveKeys(parseCode(code)!);
    expect(b1.vaultId).toBe(b2.vaultId);
    expect(b1.auth).toBe(b2.auth);
    expect(a.vaultId).not.toBe(b1.vaultId);
    expect(b1.vaultId).toMatch(/^[0-9a-f]{32}$/);
    expect(b1.auth).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('records are encrypted, bound to their key, unreadable with another code', async () => {
    const keys = await deriveKeys(parseCode(newCode())!);
    const other = await deriveKeys(parseCode(newCode())!);
    const k = await recordKey(keys, 'entries:e1');
    const sealed = await seal(keys, k, { secret: 'кефір' });
    expect(atob(sealed)).not.toContain('secret');
    expect(await open(keys, k, sealed)).toEqual({ secret: 'кефір' });
    await expect(open(keys, await recordKey(keys, 'entries:e2'), sealed)).rejects.toThrow();
    await expect(open(other, k, sealed)).rejects.toThrow();
  });
});

describe('sync between two devices', () => {
  it('a meal, a dish, a weight and a deletion travel; built-in foods do not', async () => {
    const code = newCode();
    const keys = await deriveKeys(parseCode(code)!);
    const server = fakeServer();
    const phone = await device(code), laptop = await device(code);

    await phone.entries.put(meal('e1', '2026-10-04T08:00:00+03:00', 'Яйце'));
    await phone.weights.put({ date: '2026-10-04', kg: 97.4 });
    await phone.recipes.put({ id: 'r-mine', name: 'Мій салат', items: [{ name: 'Огірок', grams: 100 }] });
    const first = await syncOnce(phone, keys, server.api, 1000);
    expect(first.pushed).toBe(4); // plan, meal, weight, dish
    expect(server.records.size).toBe(4);
    expect([...server.records.values()].every((r) => !r.v!.includes('Яйце'))).toBe(true);

    await syncOnce(laptop, keys, server.api, 2000);
    expect(await laptop.entries.get('e1')).toMatchObject({ items: [{ name: 'Яйце' }] });
    expect(await laptop.weights.get('2026-10-04')).toEqual({ date: '2026-10-04', kg: 97.4 });
    expect(await laptop.recipes.get('r-mine')).toBeDefined();

    await laptop.entries.delete('e1');
    await syncOnce(laptop, keys, server.api, 3000);
    await syncOnce(phone, keys, server.api, 4000);
    expect(await phone.entries.get('e1')).toBeUndefined();
  });

  it('the later change wins a conflict; nothing is sent twice', async () => {
    const code = newCode();
    const keys = await deriveKeys(parseCode(code)!);
    const server = fakeServer();
    const phone = await device(code), laptop = await device(code);
    await phone.entries.put(meal('e1', '2026-10-04T13:00:00+03:00', 'Гречка'));
    await syncOnce(phone, keys, server.api, 1000);
    await syncOnce(laptop, keys, server.api, 1100);

    await laptop.entries.put(meal('e1', '2026-10-04T13:00:00+03:00', 'Рис')); // seen at 2000
    await syncOnce(laptop, keys, server.api, 2000);
    await phone.entries.put(meal('e1', '2026-10-04T13:00:00+03:00', 'Булгур')); // seen at 3000 — later
    await syncOnce(phone, keys, server.api, 3000);
    expect((await phone.entries.get('e1'))!.items![0]!.name).toBe('Булгур');
    await syncOnce(laptop, keys, server.api, 4000);
    expect((await laptop.entries.get('e1'))!.items![0]!.name).toBe('Булгур');

    const again = await syncOnce(laptop, keys, server.api, 5000);
    expect(again).toEqual({ pulled: 0, pushed: 0 });
  });

  it('a new device takes the vault\'s plan instead of pushing its example plan', async () => {
    const code = newCode();
    const keys = await deriveKeys(parseCode(code)!);
    const server = fakeServer();
    const phone = await device(code);
    await phone.plan.update('main', { onboardedAt: '2026-10-01', targets: { proteinG: 120 } });
    await syncOnce(phone, keys, server.api, 1000);

    const laptop = await device(code); // fresh: example plan, not onboarded
    await laptop.entries.put(meal('e9', '2026-10-04T19:00:00+03:00', 'Кефір'));
    await syncOnce(laptop, keys, server.api, 9000);
    expect(await laptop.plan.get('main')).toMatchObject({ onboardedAt: '2026-10-01', targets: { proteinG: 120 } });
    await syncOnce(phone, keys, server.api, 9500);
    expect(await phone.entries.get('e9')).toBeDefined(); // its own entries still go up
  });

  it('a change made offline keeps the time it was made', async () => {
    const code = newCode();
    const keys = await deriveKeys(parseCode(code)!);
    const server = fakeServer();
    const phone = await device(code), laptop = await device(code);
    await phone.entries.put(meal('e1', '2026-10-04T13:00:00+03:00', 'Гречка'));
    await syncOnce(phone, keys, server.api, 1000);
    await syncOnce(laptop, keys, server.api, 1100);

    await phone.entries.put(meal('e1', '2026-10-04T13:00:00+03:00', 'Офлайн'));
    const offline: Api = { pull: async () => { throw new Error('offline'); }, push: async () => { throw new Error('offline'); } };
    await expect(syncOnce(phone, keys, offline, 2000)).rejects.toThrow('offline');
    await laptop.entries.put(meal('e1', '2026-10-04T13:00:00+03:00', 'Пізніше'));
    await syncOnce(laptop, keys, server.api, 3000);
    await syncOnce(phone, keys, server.api, 4000); // back online: its change was at 2000, the laptop's at 3000
    expect((await phone.entries.get('e1'))!.items![0]!.name).toBe('Пізніше');
  });

  it('hash ignores key order and undefined fields', () => {
    expect(hashOf({ a: 1, b: [1, { c: 2, d: undefined }] })).toBe(hashOf({ b: [1, { c: 2 }], a: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
  });
});
