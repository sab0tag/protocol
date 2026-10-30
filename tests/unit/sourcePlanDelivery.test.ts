import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtocolDB } from '../../src/data/db';
import { profileDatabase } from '../../src/data/profiles';
import { prepareLegacyPlanCore } from '../../src/data/carePlans';
import { emptyPlan } from '../../src/data/seed.example';
import { exportAll } from '../../src/data/backup';
import { ApiError } from '../../src/sync/api';
import { deriveKeys, newCode, parseCode } from '../../src/sync/crypto';
import { captureSourcePlanCatalog, encryptSourcePlanCatalog } from '../../src/sync/sourcePlans';
import { deliverSourcePlanSend, prepareSourcePlanSend } from '../../src/sync/sourcePlanDelivery';
import type { RemoteRecord } from '../../src/sync/engine';

const databases: ProtocolDB[] = [];
async function device() {
  const code = newCode(), keys = await deriveKeys(parseCode(code)!), person = crypto.randomUUID();
  const db = new ProtocolDB(profileDatabase(person)); databases.push(db);
  await db.meta.put({ key: 'sync', code, seq: 9 });
  await db.plan.put({ ...emptyPlan(), id: 'main' }); await prepareLegacyPlanCore(db, person);
  return { code, keys, db };
}
function server() {
  let revision = 0;
  const records = new Map<string, RemoteRecord>();
  const api = {
    push: vi.fn(async (rows: { k: string; v: string | null }[], expectedSeq: number) => {
      if (expectedSeq !== revision) throw new ApiError(409, 'record_conflict', { seq: revision });
      for (const r of rows) records.set(r.k, { ...r, seq: ++revision });
      return { seq: revision };
    }),
    pull: vi.fn(async (since: number) => ({ records: [...records.values()].filter(r => r.seq > since), more: false, seq: revision })),
  };
  return { api, records };
}
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete(); });

describe('durable source-plan send preparation (runner stays disabled)', () => {
  it('persists only encrypted pending data, resumes after reopen, and keeps newer local edits dirty', async () => {
    const { db, keys } = await device(), remote = server();
    const original = await captureSourcePlanCatalog(db), pending = await prepareSourcePlanSend(db, keys, 0);
    const saved = await db.meta.get('sync');
    expect(JSON.stringify(saved!.sourcePlanDelivery)).not.toContain(original.plans[0]!.title);
    expect(JSON.stringify(await exportAll(db))).not.toContain(pending.record.v);
    db.close(); const reopened = new ProtocolDB(db.name);
    try {
      await reopened.carePlans.update(original.plans[0]!.id, { title: 'Synthetic local edit after preparation' });
      const edited = await captureSourcePlanCatalog(reopened);
      expect(await deliverSourcePlanSend(reopened, keys, remote.api)).toEqual({ status: 'acknowledged', seq: 1, recovered: false });
      expect(remote.api.push).toHaveBeenCalledWith([pending.record], 0);
      expect(await captureSourcePlanCatalog(reopened)).toEqual(edited);
      const meta = (await reopened.meta.get('sync'))!;
      expect(meta.seq).toBe(9); expect(meta.sourcePlanDelivery!.pending).toBeUndefined();
      expect(meta.sourcePlanDelivery!.acknowledged).toEqual({ record: pending.record, seq: 1 });
      expect(await deliverSourcePlanSend(reopened, keys, remote.api)).toEqual({ status: 'idle' });
      const next = await prepareSourcePlanSend(reopened, keys, 1); expect(next.record.v).not.toBe(pending.record.v);
    } finally { reopened.close(); }
  });

  it('keeps exactly the same ciphertext after a lost successful response and recovers without a second write', async () => {
    const { db, keys } = await device(), remote = server(), pending = await prepareSourcePlanSend(db, keys, 0);
    const push = remote.api.push.getMockImplementation()!;
    remote.api.push.mockImplementationOnce(async (...args) => { await push(...args); throw new ApiError(0, 'offline'); });
    await expect(deliverSourcePlanSend(db, keys, remote.api)).rejects.toMatchObject({ code: 'offline' });
    expect((await db.meta.get('sync'))!.sourcePlanDelivery!.pending).toEqual(pending);
    expect(await deliverSourcePlanSend(db, keys, remote.api)).toEqual({ status: 'acknowledged', seq: 1, recovered: true });
    expect(remote.records.get(pending.record.k)).toEqual({ ...pending.record, seq: 1 });
    expect(remote.api.push.mock.calls).toEqual([[[pending.record], 0], [[pending.record], 0]]);
  });

  it('preserves the pending draft on a different remote winner, tombstone or missing record; never blindly rebases', async () => {
    for (const kind of ['different', 'tombstone', 'missing']) {
      const { db, keys } = await device(), remote = server(), pending = await prepareSourcePlanSend(db, keys, 0);
      const before = await captureSourcePlanCatalog(db), alternative = structuredClone(before);
      alternative.plans[0]!.title = 'Synthetic other device';
      const other = await encryptSourcePlanCatalog(keys, alternative);
      await remote.api.push([{ k: kind === 'missing' ? 'unrelated' : other.k, v: kind === 'tombstone' ? null : other.v }], 0);
      expect(await deliverSourcePlanSend(db, keys, remote.api)).toMatchObject({ status: 'conflict', seq: 1 });
      expect((await db.meta.get('sync'))!.sourcePlanDelivery!.pending).toEqual(pending);
      expect(await captureSourcePlanCatalog(db)).toEqual(before);
      expect(remote.api.push.mock.calls.at(-1)).toEqual([[pending.record], 0]);
      await expect(prepareSourcePlanSend(db, keys, 1)).rejects.toThrow('source_plan_send_pending');
    }
  });

  it('reads through all pages: a later replacement cancels an early apparent acknowledgement', async () => {
    const { db, keys } = await device(), remote = server(), pending = await prepareSourcePlanSend(db, keys, 0);
    remote.api.push.mockRejectedValue(new ApiError(409, 'record_conflict', { seq: 999 }));
    const replacement = { ...pending.record, v: null, seq: 3 };
    remote.api.pull.mockResolvedValueOnce({ records: [{ ...pending.record, seq: 1 }], more: true, seq: 1 })
      .mockResolvedValueOnce({ records: [{ k: 'other', v: 'AAAA', seq: 2 }, replacement], more: false, seq: 3 });
    expect(await deliverSourcePlanSend(db, keys, remote.api)).toEqual({ status: 'conflict', seq: 3, remote: replacement });
    expect(remote.api.pull.mock.calls).toEqual([[0], [1]]);
    expect((await db.meta.get('sync'))!.sourcePlanDelivery!.pending).toEqual(pending);
  });

  it('recovers the actual record revision after all pages, without moving the unrelated legacy cursor', async () => {
    const { db, keys } = await device(), remote = server(), pending = await prepareSourcePlanSend(db, keys, 0);
    remote.api.push.mockRejectedValue(new ApiError(409, 'record_conflict', { seq: 999 }));
    remote.api.pull.mockResolvedValueOnce({ records: [{ ...pending.record, seq: 1 }], more: true, seq: 1 })
      .mockResolvedValueOnce({ records: [{ k: 'other', v: 'AAAA', seq: 8 }], more: false, seq: 8 });
    expect(await deliverSourcePlanSend(db, keys, remote.api)).toEqual({ status: 'acknowledged', seq: 1, recovered: true });
    expect((await db.meta.get('sync'))!.seq).toBe(9);
    await expect(prepareSourcePlanSend(db, keys, 0)).rejects.toThrow('source_plan_remote_rollback');
  });

  it('retains pending data on unavailable/older servers, authorization failures and malformed acknowledgements', async () => {
    const { db, keys } = await device(), remote = server(), pending = await prepareSourcePlanSend(db, keys, 0);
    for (const status of [0, 401, 404, 409, 503]) {
      remote.api.push.mockRejectedValueOnce(new ApiError(status, status === 409 ? 'protocol_opt_in_required' : 'unavailable'));
      await expect(deliverSourcePlanSend(db, keys, remote.api)).rejects.toMatchObject({ status });
      expect((await db.meta.get('sync'))!.sourcePlanDelivery!.pending).toEqual(pending);
    }
    for (const seq of [undefined, NaN, 0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      remote.api.push.mockResolvedValueOnce({ seq: seq as number });
      await expect(deliverSourcePlanSend(db, keys, remote.api)).rejects.toThrow('source_plan_ack_invalid');
      expect((await db.meta.get('sync'))!.sourcePlanDelivery!.pending).toEqual(pending);
    }
    expect(remote.api.pull).not.toHaveBeenCalled();
  });

  it('rejects invalid pagination, incomplete reads and apparent restored revisions without clearing pending data', async () => {
    const { db, keys } = await device(), remote = server(), pending = await prepareSourcePlanSend(db, keys, 5);
    remote.api.push.mockRejectedValue(new ApiError(409, 'record_conflict'));
    for (const page of [
      { records: [], more: true, seq: 0 }, { records: [{ ...pending.record, seq: 1 }], more: false, seq: 2 },
      { records: [{ ...pending.record, seq: 0 }], more: false, seq: 0 }, { records: [], more: false, seq: -1 },
    ]) {
      remote.api.pull.mockResolvedValueOnce(page);
      await expect(deliverSourcePlanSend(db, keys, remote.api)).rejects.toThrow('source_plan_page_invalid');
    }
    remote.api.pull.mockResolvedValueOnce({ records: [{ ...pending.record, seq: 4 }], more: false, seq: 4 });
    await expect(deliverSourcePlanSend(db, keys, remote.api)).rejects.toThrow('source_plan_remote_rollback');
    remote.api.pull.mockRejectedValueOnce(new ApiError(0, 'offline'));
    await expect(deliverSourcePlanSend(db, keys, remote.api)).rejects.toMatchObject({ code: 'offline' });
    expect((await db.meta.get('sync'))!.sourcePlanDelivery!.pending).toEqual(pending);
  });

  it('serializes competing preparations across connections and refuses local edits during encryption', async () => {
    const { db, keys } = await device(), other = new ProtocolDB(db.name);
    try {
      const results = await Promise.allSettled([prepareSourcePlanSend(db, keys, 0), prepareSourcePlanSend(other, keys, 0)]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect((await db.meta.get('sync'))!.sourcePlanDelivery!.pending).toBeDefined();
    } finally { other.close(); }
    const second = await device(), encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const plan = (await second.db.carePlans.toArray())[0]!;
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => {
      await second.db.carePlans.update(plan.id, { title: 'Synthetic intervening edit' }); return encrypt(...args);
    });
    await expect(prepareSourcePlanSend(second.db, second.keys, 0)).rejects.toThrow('source_plan_local_conflict');
    expect((await second.db.meta.get('sync'))!.sourcePlanDelivery).toBeUndefined();
  });

  it('refuses a different vault and cannot acknowledge into a re-paired profile after the server accepts', async () => {
    const { db, keys } = await device(), remote = server(), pending = await prepareSourcePlanSend(db, keys, 0);
    const otherCode = newCode(), otherKeys = await deriveKeys(parseCode(otherCode)!);
    await expect(deliverSourcePlanSend(db, otherKeys, remote.api)).rejects.toThrow('source_plan_vault_mismatch');
    expect(remote.api.push).not.toHaveBeenCalled();
    const push = remote.api.push.getMockImplementation()!;
    remote.api.push.mockImplementationOnce(async (...args) => {
      const ack = await push(...args); await db.meta.put({ key: 'sync', code: otherCode, seq: 77 }); return ack;
    });
    await expect(deliverSourcePlanSend(db, keys, remote.api)).rejects.toThrow('source_plan_vault_mismatch');
    expect(await db.meta.get('sync')).toEqual({ key: 'sync', code: otherCode, seq: 77 });
    expect(remote.records.get(pending.record.k)?.v).toBe(pending.record.v);
  });

  it('does not clear a newer pending operation when an older response arrives late', async () => {
    const { db, keys } = await device(), remote = server(); await prepareSourcePlanSend(db, keys, 0);
    let resolve!: (ack: { seq: number }) => void;
    remote.api.push.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const old = deliverSourcePlanSend(db, keys, remote.api);
    await vi.waitFor(() => expect(remote.api.push).toHaveBeenCalled());
    // Another connection can acknowledge the same operation and prepare the following one.
    expect(await deliverSourcePlanSend(db, keys, remote.api)).toMatchObject({ status: 'acknowledged' });
    const next = await prepareSourcePlanSend(db, keys, 1); resolve({ seq: 1 });
    await expect(old).rejects.toThrow('source_plan_delivery_changed');
    expect((await db.meta.get('sync'))!.sourcePlanDelivery!.pending).toEqual(next);
  });

  it('keeps pending data if the acknowledgement transaction fails; the next call recovers', async () => {
    const { db, keys } = await device(), remote = server(), pending = await prepareSourcePlanSend(db, keys, 0);
    const fail = () => { throw new Error('synthetic_ack_storage_failure'); };
    db.meta.hook('updating', fail);
    await expect(deliverSourcePlanSend(db, keys, remote.api)).rejects.toThrow('synthetic_ack_storage_failure');
    db.meta.hook('updating').unsubscribe(fail);
    expect((await db.meta.get('sync'))!.sourcePlanDelivery!.pending).toEqual(pending);
    expect(await deliverSourcePlanSend(db, keys, remote.api)).toEqual({ status: 'acknowledged', seq: 1, recovered: true });
  });
});
