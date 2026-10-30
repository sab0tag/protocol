/** Durable conditional source-catalog sends. Not connected to the ordinary runner or vault opt-in. */
import type { ProtocolDB } from '../data/db';
import { ApiError, conditionalVaultApi } from './api';
import { deriveKeys, parseCode, type Keys } from './crypto';
import { stable, type RemoteRecord } from './engine';
import { captureSourcePlanCatalog, decryptSourcePlanCatalog, encryptSourcePlanCatalog, type SourcePlanRecord } from './sourcePlans';

export interface PendingSourcePlanSend {
  id: string;
  expectedSeq: number;
  record: SourcePlanRecord;
}
export interface SourcePlanDelivery {
  v: 1;
  vaultId: string;
  pending?: PendingSourcePlanSend;
  acknowledged?: { record: SourcePlanRecord; seq: number };
}
type ConditionalApi = ReturnType<typeof conditionalVaultApi>;
export type DeliveryResult =
  | { status: 'idle' }
  | { status: 'acknowledged'; seq: number; recovered: boolean }
  | { status: 'conflict'; seq: number; remote: RemoteRecord | null };
const sequence = (v: number) => Number.isSafeInteger(v) && v >= 0;
const stores = (db: ProtocolDB) => [db.meta, db.carePlans, db.carePlanItems, db.planMigrations];

async function binding(db: ProtocolDB, keys: Keys) {
  const meta = await db.meta.get('sync'), code = meta && parseCode(meta.code);
  if (!code || (await deriveKeys(code)).vaultId !== keys.vaultId) throw new Error('source_plan_vault_mismatch');
  if (meta.sourcePlanDelivery && (meta.sourcePlanDelivery.v !== 1 || meta.sourcePlanDelivery.vaultId !== keys.vaultId))
    throw new Error('source_plan_delivery_invalid');
  if (meta.sourcePlanDelivery?.acknowledged && !sequence(meta.sourcePlanDelivery.acknowledged.seq))
    throw new Error('source_plan_delivery_invalid');
  return meta;
}

/** Caller supplies the revision of a complete remote read and explicitly chooses this local catalog.
 * Encryption finishes outside IndexedDB; the final transaction compares binding, outbox and catalog.
 * An existing pending send must be resolved first. A later local edit never replaces its ciphertext. */
export async function prepareSourcePlanSend(db: ProtocolDB, keys: Keys, expectedSeq: number): Promise<PendingSourcePlanSend> {
  if (!sequence(expectedSeq)) throw new Error('source_plan_revision_invalid');
  const meta = await binding(db, keys);
  if (meta.sourcePlanDelivery?.pending) throw new Error('source_plan_send_pending');
  if (expectedSeq < (meta.sourcePlanDelivery?.acknowledged?.seq ?? 0)) throw new Error('source_plan_remote_rollback');
  const catalog = await captureSourcePlanCatalog(db);
  const pending = { id: crypto.randomUUID(), expectedSeq, record: await encryptSourcePlanCatalog(keys, catalog) };
  await db.transaction('rw', stores(db), async () => {
    const current = await db.meta.get('sync');
    if (current?.code !== meta.code) throw new Error('source_plan_vault_mismatch');
    if (stable(current.sourcePlanDelivery) !== stable(meta.sourcePlanDelivery)) throw new Error('source_plan_delivery_changed');
    if (stable(await captureSourcePlanCatalog(db)) !== stable(catalog)) throw new Error('source_plan_local_conflict');
    await db.meta.update('sync', { sourcePlanDelivery: { ...meta.sourcePlanDelivery, v: 1, vaultId: keys.vaultId, pending } });
  });
  return structuredClone(pending);
}

/** Read all pages from zero, including tombstones. An early matching record is never an acknowledgement:
 * a later page can contain its replacement. Bound malformed/nonadvancing pagination before any local write. */
async function remoteHead(api: ConditionalApi, key: string): Promise<{ remote: RemoteRecord | null; seq: number }> {
  let since = 0, remote: RemoteRecord | null = null;
  for (let count = 0; count < 1000; count++) {
    const page = await api.pull(since);
    if (!page || !Array.isArray(page.records) || typeof page.more !== 'boolean' || !sequence(page.seq) || page.seq < since)
      throw new Error('source_plan_page_invalid');
    let last = since;
    for (const row of page.records) {
      if (!row || typeof row.k !== 'string' || (row.v !== null && typeof row.v !== 'string') || !sequence(row.seq) || row.seq <= last)
        throw new Error('source_plan_page_invalid');
      last = row.seq;
      if (row.k === key) remote = { ...row };
    }
    if (page.records.length ? page.seq !== last : page.more) throw new Error('source_plan_page_invalid');
    if (!page.more) return { remote, seq: page.seq };
    since = page.seq;
  }
  throw new Error('source_plan_page_limit');
}

/** Resume the exact saved ciphertext/condition after reopening. Network/server failures preserve it.
 * On 409, only an exact current remote ciphertext at a later revision recovers the acknowledgement.
 * A conflict preserves both the outbox and local catalog; returned remote data is not applied or rebased. */
export async function deliverSourcePlanSend(db: ProtocolDB, keys: Keys, api: ConditionalApi = conditionalVaultApi(keys)): Promise<DeliveryResult> {
  const meta = await binding(db, keys), pending = meta.sourcePlanDelivery?.pending;
  if (!pending) return { status: 'idle' };
  if (typeof pending.id !== 'string' || !pending.id || !sequence(pending.expectedSeq)) throw new Error('source_plan_delivery_invalid');
  // Reject corrupted persisted ciphertext before any network request.
  await decryptSourcePlanCatalog(keys, pending.record);
  const check = async () => {
    const current = await db.meta.get('sync');
    if (current?.code !== meta.code) throw new Error('source_plan_vault_mismatch');
    if (stable(current.sourcePlanDelivery) !== stable(meta.sourcePlanDelivery)) throw new Error('source_plan_delivery_changed');
  };
  await check();
  let seq: number, recovered = false;
  try {
    seq = (await api.push([pending.record], pending.expectedSeq)).seq;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409 || error.code !== 'record_conflict') throw error;
    const head = await remoteHead(api, pending.record.k);
    await check();
    if (head.seq < pending.expectedSeq) throw new Error('source_plan_remote_rollback');
    if (!head.remote || head.remote.v !== pending.record.v || head.remote.seq <= pending.expectedSeq)
      return { status: 'conflict', ...head };
    seq = head.remote.seq;
    recovered = true;
  }
  if (!sequence(seq) || seq <= pending.expectedSeq) throw new Error('source_plan_ack_invalid');
  await db.transaction('rw', db.meta, async () => {
    await check();
    await db.meta.update('sync', { sourcePlanDelivery: { v: 1, vaultId: keys.vaultId, acknowledged: { record: pending.record, seq } } });
  });
  return { status: 'acknowledged', seq, recovered };
}
