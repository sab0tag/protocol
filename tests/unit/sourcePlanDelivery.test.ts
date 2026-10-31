import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtocolDB } from '../../src/data/db';
import { profileDatabase } from '../../src/data/profiles';
import { prepareLegacyPlanCore } from '../../src/data/carePlans';
import { emptyPlan } from '../../src/data/seed.example';
import { exportAll, importAll } from '../../src/data/backup';
import { ApiError } from '../../src/sync/api';
import { deriveKeys, newCode, parseCode } from '../../src/sync/crypto';
import { applySourcePlanCatalog, captureSourcePlanCatalog, encryptSourcePlanCatalog } from '../../src/sync/sourcePlans';
import { deliverSourcePlanSend, inspectSourcePlanConflict, prepareSourcePlanSend } from '../../src/sync/sourcePlanDelivery';
import { recoverSourcePlanQueue } from '../../src/sync/sourcePlanRecovery';
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
      { records: [{ ...pending.record, seq: 0 }], more: false, seq: 0 }, { records: [], more: false, seq: -1 }, { records: [], more: false, seq: 6 },
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

describe('read-only source-plan conflict review', () => {
  it('keeps the agreed baseline, prepared send, later local edit and remote winner separate without writes', async () => {
    const { db, keys } = await device(), remote = server(), agreed = await captureSourcePlanCatalog(db);
    await prepareSourcePlanSend(db, keys, 0); await deliverSourcePlanSend(db, keys, remote.api);
    const id = agreed.plans[0]!.id;
    await db.carePlans.update(id, { title: 'Synthetic prepared version' });
    const prepared = await captureSourcePlanCatalog(db), pending = await prepareSourcePlanSend(db, keys, 1);
    await db.carePlans.update(id, { title: 'Synthetic later local version' });
    const local = await captureSourcePlanCatalog(db), winner = structuredClone(agreed);
    winner.plans[0]!.title = 'Synthetic remote winner';
    await remote.api.push([await encryptSourcePlanCatalog(keys, winner)], 1);
    const before = await db.meta.get('sync'), calls = remote.api.push.mock.calls.length;
    const review = await inspectSourcePlanConflict(db, keys, remote.api);
    expect(review).toEqual({ pendingId: pending.id, expectedSeq: 1, remoteSeq: 2, remoteState: 'catalog',
      localChangedSincePreparation: true, remoteMatchesPending: false, acknowledged: agreed, pending: prepared, local, remote: winner });
    expect(remote.api.push).toHaveBeenCalledTimes(calls);
    expect(await db.meta.get('sync')).toEqual(before); expect(await captureSourcePlanCatalog(db)).toEqual(local);
    review.local.plans[0]!.title = 'Modified returned data';
    expect(await captureSourcePlanCatalog(db)).toEqual(local);
  });

  it('distinguishes missing, tombstoned and genuinely empty remote catalogs; never invents a common baseline', async () => {
    for (const state of ['missing', 'deleted', 'catalog'] as const) {
      const { db, keys } = await device(), remote = server(), pending = await prepareSourcePlanSend(db, keys, 0);
      if (state === 'deleted') await remote.api.push([{ k: pending.record.k, v: null }], 0);
      if (state === 'catalog') await remote.api.push([await encryptSourcePlanCatalog(keys, { v: 1, plans: [], items: [], migrations: [] })], 0);
      const before = await db.meta.get('sync'), review = await inspectSourcePlanConflict(db, keys, remote.api);
      expect(review.remoteState).toBe(state); expect(review.acknowledged).toBeNull();
      expect(review.remote).toEqual(state === 'catalog' ? { v: 1, plans: [], items: [], migrations: [] } : null);
      expect(review.pending.plans.length).toBeGreaterThan(0); expect(review.remoteMatchesPending).toBe(false);
      expect(await db.meta.get('sync')).toEqual(before);
    }
  });

  it('recognizes exact committed pending ciphertext for review without clearing it or applying it', async () => {
    const { db, keys } = await device(), remote = server(), pending = await prepareSourcePlanSend(db, keys, 0);
    await remote.api.push([pending.record], 0); const before = await db.meta.get('sync');
    const review = await inspectSourcePlanConflict(db, keys, remote.api);
    expect(review.remoteMatchesPending).toBe(true); expect(review.localChangedSincePreparation).toBe(false);
    expect(review.remote).toEqual(review.pending); expect(await db.meta.get('sync')).toEqual(before);
  });

  it('rejects foreign or malformed encrypted remote and baseline versions without changing the draft', async () => {
    const { db, keys } = await device(), remote = server(), pending = await prepareSourcePlanSend(db, keys, 0);
    const other = await device(), foreign = await encryptSourcePlanCatalog(other.keys, await captureSourcePlanCatalog(other.db));
    await remote.api.push([{ k: pending.record.k, v: foreign.v }], 0);
    const before = await db.meta.get('sync'), local = await captureSourcePlanCatalog(db);
    await expect(inspectSourcePlanConflict(db, keys, remote.api)).rejects.toThrow();
    expect(await db.meta.get('sync')).toEqual(before); expect(await captureSourcePlanCatalog(db)).toEqual(local);
    await db.meta.update('sync', { sourcePlanDelivery: { ...before!.sourcePlanDelivery!, acknowledged: { record: foreign, seq: 0 } } });
    const pulls = remote.api.pull.mock.calls.length;
    await expect(inspectSourcePlanConflict(db, keys, remote.api)).rejects.toThrow('source_plan_record_mismatch');
    expect(remote.api.pull).toHaveBeenCalledTimes(pulls);
  });

  it('rejects a stale review if another caller acknowledges during the remote read or the profile is re-paired', async () => {
    for (const change of ['acknowledge', 'repair']) {
      const { db, keys } = await device(), remote = server(); await prepareSourcePlanSend(db, keys, 0);
      const pull = remote.api.pull.getMockImplementation()!;
      remote.api.pull.mockImplementationOnce(async since => {
        if (change === 'acknowledge') await deliverSourcePlanSend(db, keys, remote.api);
        else await db.meta.put({ key: 'sync', code: newCode(), seq: 0 });
        return pull(since);
      });
      await expect(inspectSourcePlanConflict(db, keys, remote.api)).rejects.toThrow(
        change === 'acknowledge' ? 'source_plan_delivery_changed' : 'source_plan_vault_mismatch');
    }
  });
});

describe('runtime recovery barriers', () => {
  it('blocks a pre-restore send atomically while preserving its encrypted evidence and the restored catalog', async () => {
    const { db, keys } = await device(), remote = server(), file = await exportAll(db);
    const pending = await prepareSourcePlanSend(db, keys, 0);
    file.sourcePlans!.plans[0]!.title = 'Synthetic explicitly restored version';
    await importAll(file, db);
    const meta = (await db.meta.get('sync'))!;
    expect(meta.sourcePlanDelivery!.blocked).toBe('restore'); expect(meta.sourcePlanDelivery!.pending).toEqual(pending);
    expect((await captureSourcePlanCatalog(db)).plans[0]!.title).toBe('Synthetic explicitly restored version');
    expect(await recoverSourcePlanQueue(db, keys, remote.api)).toEqual({ kind: 'restored' });
    await expect(deliverSourcePlanSend(db, keys, remote.api)).rejects.toThrow('source_plan_restore_required');
    await expect(prepareSourcePlanSend(db, keys, 0)).rejects.toThrow('source_plan_restore_required');
    expect(remote.api.push).not.toHaveBeenCalled(); expect(remote.api.pull).not.toHaveBeenCalled();
  });

  it('rolls back the recovery barrier if restoring the catalog fails', async () => {
    const { db, keys } = await device(), file = await exportAll(db); await prepareSourcePlanSend(db, keys, 0);
    const before = await db.meta.get('sync'), catalog = await captureSourcePlanCatalog(db);
    const fail = () => { throw new Error('synthetic_restore_failure'); }; db.carePlans.hook('creating', fail);
    await expect(importAll(file, db)).rejects.toThrow('synthetic_restore_failure'); db.carePlans.hook('creating').unsubscribe(fail);
    expect(await db.meta.get('sync')).toEqual(before); expect(await captureSourcePlanCatalog(db)).toEqual(catalog);
  });

  it('preserves a pending send when stopped during HTTP and recovers only after explicit resume', async () => {
    const { db, keys } = await device(), remote = server(), pending = await prepareSourcePlanSend(db, keys, 0);
    const push = remote.api.push.getMockImplementation()!;
    remote.api.push.mockImplementationOnce(async (...args) => {
      const ack = await push(...args); await db.meta.update('sync', { paused: true }); return ack;
    });
    await expect(recoverSourcePlanQueue(db, keys, remote.api)).rejects.toThrow('source_plan_sync_paused');
    expect((await db.meta.get('sync'))!.sourcePlanDelivery!.pending).toEqual(pending);
    const calls = remote.api.push.mock.calls.length;
    await expect(recoverSourcePlanQueue(db, keys, remote.api)).rejects.toThrow('source_plan_sync_paused');
    await expect(prepareSourcePlanSend(db, keys, 1)).rejects.toThrow('source_plan_sync_paused');
    expect(remote.api.push).toHaveBeenCalledTimes(calls);
    await db.meta.update('sync', { paused: false });
    expect(await recoverSourcePlanQueue(db, keys, remote.api)).toEqual({ kind: 'acknowledged' });
    expect(remote.records.get(pending.record.k)!.seq).toBe(1);
  });
});


describe('catalog replacement safety with pending delivery', () => {
  it('refuses remote replacement while a durable clinical send is pending and preserves both versions', async () => {
    const { db, keys } = await device();
    const local = await captureSourcePlanCatalog(db);
    const remote = await encryptSourcePlanCatalog(keys, local);
    const pending = await prepareSourcePlanSend(db, keys, 0);
    await expect(applySourcePlanCatalog(db, keys, remote, local)).rejects.toThrow('source_plan_send_pending');
    expect(await captureSourcePlanCatalog(db)).toEqual(local);
    expect((await db.meta.get('sync'))?.sourcePlanDelivery?.pending).toEqual(pending);
  });
});
