import { describe, expect, it } from 'vitest';
import { ensureSeeded, ProtocolDB } from '../../src/data/db';
import { deriveKeys, formatCode, newCode, open, parseCode, recordKey, seal } from '../../src/sync/crypto';
import { hashOf, planFromRecords, repairPlan, syncOnce, type Api, type RemoteRecord } from '../../src/sync/engine';
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
    await phone.favorites.put({ id: 'f1', title: 'Моя вівсянка', items: [{ name: 'Вівсянка', grams: 60 }] }); // D51
    const first = await syncOnce(phone, keys, server.api, 1000);
    const planParts = Object.keys(await phone.plan.get('main') ?? {}).filter((k) => k !== 'id').length;
    expect(first.pushed).toBe(4 + planParts); // meal, weight, dish, favorite + the plan by parts
    expect(server.records.size).toBe(4 + planParts);
    expect([...server.records.values()].every((r) => !r.v!.includes('Яйце'))).toBe(true);

    await syncOnce(laptop, keys, server.api, 2000);
    expect(await laptop.entries.get('e1')).toMatchObject({ items: [{ name: 'Яйце' }] });
    expect(await laptop.weights.get('2026-10-04')).toEqual({ date: '2026-10-04', kg: 97.4 });
    expect(await laptop.recipes.get('r-mine')).toBeDefined();
    expect(await laptop.favorites.get('f1')).toMatchObject({ title: 'Моя вівсянка' });

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

  it('the plan by parts: targets edited on one device and limits on another — both stay (D40)', async () => {
    const code = newCode();
    const keys = await deriveKeys(parseCode(code)!);
    const server = fakeServer();
    const phone = await device(code), laptop = await device(code);
    await syncOnce(phone, keys, server.api, 1000);
    await syncOnce(laptop, keys, server.api, 1100);
    await laptop.plan.update('main', { targets: { proteinG: 150 } });
    const limits = (await phone.plan.get('main'))!.constraints.map((c) => ({ ...c, active: false }));
    await phone.plan.update('main', { constraints: limits, nextCheckup: undefined });
    await syncOnce(laptop, keys, server.api, 2000);
    await syncOnce(phone, keys, server.api, 3000);
    await syncOnce(laptop, keys, server.api, 4000);
    for (const db of [phone, laptop]) {
      const p = (await db.plan.get('main'))!;
      expect(p.targets).toEqual({ proteinG: 150 });
      expect(p.constraints.every((c) => !c.active)).toBe(true);
      expect(p.nextCheckup).toBeUndefined(); // a removed part is removed everywhere
    }
  });

  it('a legacy whole-plan record from an old version is still applied', async () => {
    const code = newCode();
    const keys = await deriveKeys(parseCode(code)!);
    const server = fakeServer();
    const k = await recordKey(keys, 'plan:main');
    const old = { id: 'main', constraints: [], prescriptions: [], modes: [], targets: { kcal: 1800 }, onboardedAt: '2026-10-01' };
    await server.api.push([{ k, v: await seal(keys, k, { t: 'plan', id: 'main', d: old, at: 500 }) }]);
    const laptop = await device(code);
    await syncOnce(laptop, keys, server.api, 1000);
    expect((await laptop.plan.get('main'))!.targets).toEqual({ kcal: 1800 });
    expect(server.records.size).toBe(1); // nothing of the example plan went up
    await syncOnce(laptop, keys, server.api, 2000); // the real plan goes up by parts once
    const other = await device(code);
    await syncOnce(other, keys, server.api, 3000);
    expect((await other.plan.get('main'))!).toMatchObject({ targets: { kcal: 1800 }, onboardedAt: '2026-10-01' });
    expect((await syncOnce(laptop, keys, server.api, 4000)).pushed).toBe(0);
  });

  it('D43: a device that misreads its plan sends no deletions; a deletion of the plan\'s backbone is never applied', async () => {
    const code = newCode();
    const keys = await deriveKeys(parseCode(code)!);
    const server = fakeServer();
    const phone = await device(code), laptop = await device(code);
    await phone.plan.update('main', { onboardedAt: '2026-10-01' });
    await syncOnce(phone, keys, server.api, 1000);
    await syncOnce(laptop, keys, server.api, 1100);
    const before = server.records.size;
    await phone.plan.delete('main'); // what a lost IndexedDB connection looks like to the sync
    expect((await syncOnce(phone, keys, server.api, 2000)).pushed).toBe(0);
    expect(server.records.size).toBe(before);

    // and if some (older) device did send such deletions, nobody applies them
    for (const f of ['constraints', 'targets']) {
      const k = await recordKey(keys, `plan:main#${f}`);
      await server.api.push([{ k, v: await seal(keys, k, { t: 'plan', id: `main#${f}`, d: null, at: 3000 }) }]);
    }
    await syncOnce(laptop, keys, server.api, 4000);
    const p = (await laptop.plan.get('main'))!;
    expect(p.constraints.length).toBeGreaterThan(0);
    expect(p.targets).toBeDefined();
  });

  it('D43: a plan that lost its parts is filled in from the vault\'s whole-plan copy and sent up again', async () => {
    const code = newCode();
    const keys = await deriveKeys(parseCode(code)!);
    const server = fakeServer();
    const real = { id: 'main', constraints: [{ id: 'c1', tag: 'lactose', title: 'Лактоза', reason: '', source: 'Лікар', active: true }],
      prescriptions: [], modes: [], targets: { proteinG: 120 }, onboardedAt: '2026-10-01' };
    const lk = await recordKey(keys, 'plan:main');
    await server.api.push([{ k: lk, v: await seal(keys, lk, { t: 'plan', id: 'main', d: real, at: 500 }) }]);
    for (const f of ['constraints', 'onboardedAt']) { // the incident: deletions of parts in the vault
      const k = await recordKey(keys, `plan:main#${f}`);
      await server.api.push([{ k, v: await seal(keys, k, { t: 'plan', id: `main#${f}`, d: null, at: 900 }) }]);
    }
    const phone = await device(code);
    await phone.plan.put({ id: 'main', prescriptions: [], modes: [], targets: { proteinG: 120 } } as never); // broken
    await phone.meta.update('sync', { seq: 9 });
    await phone.sync.put({ tid: 'plan:main#targets', k: await recordKey(keys, 'plan:main#targets'), h: hashOf({ v: { proteinG: 120 } }) });
    expect(await repairPlan(phone, keys, server.api)).toBe(true);
    expect(await phone.plan.get('main')).toMatchObject({ constraints: real.constraints, onboardedAt: '2026-10-01' });
    await syncOnce(phone, keys, server.api, 1000);
    const fresh = await device(code); // a new device takes the repaired plan
    await syncOnce(fresh, keys, server.api, 2000);
    expect(await fresh.plan.get('main')).toMatchObject({ constraints: real.constraints, onboardedAt: '2026-10-01' });
    expect(await repairPlan(phone, keys, server.api)).toBe(false); // nothing to do any more
  });

  it('D44: an earlier plan from records — the whole plan, its later parts on top, backbone deletions ignored', async () => {
    const keys = await deriveKeys(parseCode(newCode())!);
    const rec = async (id: string, d: unknown, at: number) => { const k = await recordKey(keys, `plan:${id}`); return { k, v: await seal(keys, k, { t: 'plan', id, d, at }) }; };
    const records = [
      await rec('main', { id: 'main', constraints: [{ title: 'Лактоза' }], prescriptions: [], modes: [], targets: { kcal: 2100 }, onboardedAt: '2026-10-01' }, 100),
      await rec('main#targets', { v: { kcal: 1900, proteinG: 140 } }, 200),
      await rec('main#constraints', null, 300),
      { k: 'x'.repeat(43), v: 'garbage' },
    ];
    const v = (await planFromRecords(keys, records, 'тест'))!;
    expect(v.plan).toMatchObject({ targets: { kcal: 1900, proteinG: 140 }, constraints: [{ title: 'Лактоза' }], onboardedAt: '2026-10-01' });
    expect(v.at).toBe(200);
    expect(await planFromRecords(keys, [], 'порожньо')).toBeNull();
  });

  it('hash ignores key order and undefined fields', () => {
    expect(hashOf({ a: 1, b: [1, { c: 2, d: undefined }] })).toBe(hashOf({ b: [1, { c: 2 }], a: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
  });
});
