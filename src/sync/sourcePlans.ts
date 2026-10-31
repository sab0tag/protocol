/** Protocol-2 source-plan transport. Deliberately not wired to the protocol-1 runner.
 * A whole catalog is one encrypted record: plans, items and recovery references commit together.
 * Negotiation, remote concurrency and conflict UI remain required before automatic synchronization. */
import type { ProtocolDB } from '../data/db';
import { databasePersonId, rebindSourcePlanBackup, sourcePlanBackup, validateSourcePlanBackup, type SourcePlanBackup } from '../data/planBackup';
import { deriveKeys, open, parseCode, recordKey, seal, type Keys } from './crypto';
import { stable } from './engine';

const OWNER = 'vault-owner';
const RECORD = 'sourcePlans:catalog:v1';
// Leave room for base64/envelope overhead within the existing 4 MB records request limit.
export const MAX_SOURCE_PLAN_BYTES = 2_500_000;
const MAX_SEALED_LENGTH = 4 * Math.ceil((MAX_SOURCE_PLAN_BYTES + 28) / 3);
const empty = (): SourcePlanBackup => ({ v: 1, plans: [], items: [], migrations: [] });
export interface SourcePlanRecord { k: string; v: string }
interface Envelope { protocol: 2; kind: 'source-plan-catalog'; vaultId: string; catalog: SourcePlanBackup }
const portable = (catalog: SourcePlanBackup) => rebindSourcePlanBackup(catalog, OWNER);

/** Capture a consistent, detached expected state. Profile ids never become cross-device identities. */
export async function captureSourcePlanCatalog(target: ProtocolDB): Promise<SourcePlanBackup> {
  return target.transaction('r', target.carePlans, target.carePlanItems, target.planMigrations, async () =>
    portable(await sourcePlanBackup(target) ?? empty()));
}

/** Reuses the vault's AES-GCM/HMAC keys. No plaintext names or profile ids appear in the record key. */
export async function encryptSourcePlanCatalog(keys: Keys, catalog: SourcePlanBackup): Promise<SourcePlanRecord> {
  const k = await recordKey(keys, RECORD);
  const envelope: Envelope = { protocol: 2, kind: 'source-plan-catalog', vaultId: keys.vaultId, catalog: portable(catalog) };
  if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > MAX_SOURCE_PLAN_BYTES) throw new Error('source_plan_catalog_too_large');
  return { k, v: await seal(keys, k, envelope) };
}

/** Authentication plus schema validation; decrypting a receipt never establishes a new clinical grant. */
export async function decryptSourcePlanCatalog(keys: Keys, record: SourcePlanRecord): Promise<SourcePlanBackup> {
  if (typeof record.v !== 'string' || record.v.length > MAX_SEALED_LENGTH) throw new Error('source_plan_catalog_too_large');
  if (record.k !== await recordKey(keys, RECORD)) throw new Error('source_plan_record_mismatch');
  const envelope = await open<Envelope>(keys, record.k, record.v);
  if (!envelope || envelope.protocol !== 2 || envelope.kind !== 'source-plan-catalog' || envelope.vaultId !== keys.vaultId ||
    Object.keys(envelope).some(k => !['protocol', 'kind', 'vaultId', 'catalog'].includes(k))) throw new Error('source_plan_envelope_invalid');
  const catalog = validateSourcePlanBackup(envelope.catalog);
  if ([...catalog.plans, ...catalog.items, ...catalog.migrations].some(row => row.personId !== OWNER) ||
    catalog.migrations.some(row => row.legacySnapshot.personId !== OWNER)) throw new Error('source_plan_owner_invalid');
  return structuredClone(catalog);
}

/** Explicit compare-and-replace only, not last-writer-wins sync. A changed local catalog fails closed.
 * This does not update the legacy journal, sync cursor, activation state or notifications.
 * Keys must match this profile's currently configured vault; re-pairing during decryption aborts the write. */
export async function applySourcePlanCatalog(target: ProtocolDB, keys: Keys, record: SourcePlanRecord, expectedLocal: SourcePlanBackup): Promise<void> {
  const binding = await target.meta.get('sync'), code = binding && parseCode(binding.code);
  if (!code || (await deriveKeys(code)).vaultId !== keys.vaultId) throw new Error('source_plan_vault_mismatch');
  const expected = stable(portable(expectedLocal));
  const incoming = rebindSourcePlanBackup(await decryptSourcePlanCatalog(keys, record), databasePersonId(target));
  await target.transaction('rw', target.carePlans, target.carePlanItems, target.planMigrations, target.meta, async () => {
    const currentBinding = await target.meta.get('sync');
    if (currentBinding?.code !== binding.code) throw new Error('source_plan_vault_mismatch');
    // A pending encrypted clinical send must survive remote catalog replacement.
    if (currentBinding.sourcePlanDelivery?.pending) throw new Error('source_plan_send_pending');
    const current = portable(await sourcePlanBackup(target) ?? empty());
    if (stable(current) !== expected) throw new Error('source_plan_local_conflict');
    await target.carePlans.clear(); await target.carePlanItems.clear(); await target.planMigrations.clear();
    await target.carePlans.bulkAdd(incoming.plans); await target.carePlanItems.bulkAdd(incoming.items); await target.planMigrations.bulkAdd(incoming.migrations);
  });
}
