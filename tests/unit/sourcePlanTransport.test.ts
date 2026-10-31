import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtocolDB } from '../../src/data/db';
import { profileDatabase } from '../../src/data/profiles';
import { prepareLegacyPlanCore, saveClinicImport, readPreparedPlans } from '../../src/data/carePlans';
import { emptyPlan } from '../../src/data/seed.example';
import { sourcePlanBackup } from '../../src/data/planBackup';
import { confirmImport, previewClinicPlan } from '../../src/domain/planImport';
import { deriveKeys, newCode, open, parseCode, recordKey, seal } from '../../src/sync/crypto';
import { applySourcePlanCatalog, captureSourcePlanCatalog, decryptSourcePlanCatalog, encryptSourcePlanCatalog, MAX_SOURCE_PLAN_BYTES } from '../../src/sync/sourcePlans';

const databases: ProtocolDB[] = [];
async function device(code: string, withData = true) {
  const personId = crypto.randomUUID(), db = new ProtocolDB(profileDatabase(personId)); databases.push(db);
  await db.meta.put({ key: 'sync', code, seq: 7 });
  await db.plan.put({ ...emptyPlan(), id: 'main', questions: ['Local journal stays here'] });
  if (withData) {
    await prepareLegacyPlanCore(db, personId);
    const preview = previewClinicPlan({ schemaVersion: 1, planId: 'synthetic-source', organizationId: 'clinic', issuedAt: '2026-10-30T10:00:00Z',
      clinician: { displayName: 'Synthetic doctor', organizationName: 'Synthetic clinic' }, title: 'Synthetic source plan',
      medications: [{ name: 'Synthetic instruction', dose: '1 unit', frequency: 'Once daily', duration: '7 days', instructions: 'Compare with source' }], restrictions: [], tests: [] })!;
    await saveClinicImport(db, personId, confirmImport(preview, ['med:0'], personId)!);
  }
  return { db, personId };
}
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete(); });
const keysFor = (code: string) => deriveKeys(parseCode(code)!);

describe('protocol-2 source-plan encrypted transport (not enabled in runner)', () => {
  it('refuses oversized catalogs before encryption and oversized records before decryption', async () => {
    const code = newCode(), keys = await keysFor(code), a = await device(code);
    const snapshot = await captureSourcePlanCatalog(a.db); snapshot.plans[0]!.title = 'x'.repeat(MAX_SOURCE_PLAN_BYTES);
    await expect(encryptSourcePlanCatalog(keys, snapshot)).rejects.toThrow('source_plan_catalog_too_large');
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt');
    await expect(decryptSourcePlanCatalog(keys, { k: 'ignored', v: 'A'.repeat(MAX_SOURCE_PLAN_BYTES * 2) })).rejects.toThrow('source_plan_catalog_too_large');
    expect(decrypt).not.toHaveBeenCalled();
  });
  it('moves one encrypted catalog between different local profiles with stable ids and no journal/activation changes', async () => {
    const code = newCode(), keys = await keysFor(code), a = await device(code), b = await device(code, false);
    const original = await readPreparedPlans(a.db, a.personId), journal = await b.db.plan.get('main'), meta = await b.db.meta.get('sync');
    const snapshot = await captureSourcePlanCatalog(a.db), expected = await captureSourcePlanCatalog(b.db);
    const record = await encryptSourcePlanCatalog(keys, snapshot);
    expect(record.k).not.toContain('sourcePlans'); expect(atob(record.v)).not.toContain('Synthetic');
    const decoded = await open<{ catalog: unknown }>(keys, record.k, record.v);
    expect(JSON.stringify(decoded)).not.toContain(a.personId);
    await applySourcePlanCatalog(b.db, keys, record, expected);
    const restored = await readPreparedPlans(b.db, b.personId);
    expect(restored).toEqual(original.map(({ plan, items }) => ({ plan: { ...plan, personId: b.personId }, items: items.map(i => ({ ...i, personId: b.personId })) })));
    expect((await b.db.planMigrations.toArray())[0]!.legacySnapshot.personId).toBe(b.personId);
    expect(restored.find(row => row.plan.source.kind === 'clinic')!.plan.status).toBe('draft');
    expect(await b.db.plan.get('main')).toEqual(journal); expect(await b.db.meta.get('sync')).toEqual(meta);
    expect(await b.db.entries.count()).toBe(0); expect(await b.db.sync.count()).toBe(0);
    expect(await readPreparedPlans(a.db, a.personId)).toEqual(original);
    expect(await decryptSourcePlanCatalog(keys, record)).toEqual(snapshot);
    expect((await encryptSourcePlanCatalog(keys, snapshot)).v).not.toBe(record.v); // fresh AES-GCM nonce
  });

  it('rejects stale local state instead of losing an edit; a fresh explicit expected state permits replacement', async () => {
    const code = newCode(), keys = await keysFor(code), a = await device(code), b = await device(code);
    const record = await encryptSourcePlanCatalog(keys, await captureSourcePlanCatalog(a.db)), stale = await captureSourcePlanCatalog(b.db);
    const plan = (await b.db.carePlans.toArray())[0]!; await b.db.carePlans.update(plan.id, { title: 'Edited in another tab' });
    const before = await sourcePlanBackup(b.db);
    await expect(applySourcePlanCatalog(b.db, keys, record, stale)).rejects.toThrow('source_plan_local_conflict');
    expect(await sourcePlanBackup(b.db)).toEqual(before);
    await applySourcePlanCatalog(b.db, keys, record, await captureSourcePlanCatalog(b.db));
    expect(await captureSourcePlanCatalog(b.db)).toEqual(await captureSourcePlanCatalog(a.db));
  });

  it('rejects foreign keys, moved records, changed ciphertext and mismatched profile-vault bindings', async () => {
    const code = newCode(), keys = await keysFor(code), other = await keysFor(newCode()), a = await device(code), b = await device(newCode(), false);
    const snapshot = await captureSourcePlanCatalog(a.db), record = await encryptSourcePlanCatalog(keys, snapshot);
    await expect(decryptSourcePlanCatalog(other, record)).rejects.toThrow();
    await expect(decryptSourcePlanCatalog(keys, { ...record, k: await recordKey(keys, 'entries:other') })).rejects.toThrow('source_plan_record_mismatch');
    const changed = record.v.slice(0, 20) + (record.v[20] === 'A' ? 'B' : 'A') + record.v.slice(21);
    await expect(decryptSourcePlanCatalog(keys, { ...record, v: changed })).rejects.toThrow();
    await expect(applySourcePlanCatalog(b.db, keys, record, await captureSourcePlanCatalog(b.db))).rejects.toThrow('source_plan_vault_mismatch');
    expect(await b.db.carePlans.count()).toBe(0);
  });

  it('rechecks vault binding after asynchronous decryption, before any catalog writes', async () => {
    const code = newCode(), keys = await keysFor(code), a = await device(code), b = await device(code, false);
    const record = await encryptSourcePlanCatalog(keys, await captureSourcePlanCatalog(a.db)), expected = await captureSourcePlanCatalog(b.db);
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(async (...args) => {
      await b.db.meta.put({ key: 'sync', code: newCode(), seq: 0 });
      return decrypt(...args);
    });
    await expect(applySourcePlanCatalog(b.db, keys, record, expected)).rejects.toThrow('source_plan_vault_mismatch');
    expect(await b.db.carePlans.count()).toBe(0); expect(await b.db.carePlanItems.count()).toBe(0);
  });

  it('serializes independent connections so two different incoming catalogs cannot both replace the same baseline', async () => {
    const code = newCode(), keys = await keysFor(code), a = await device(code), b = await device(code, false);
    const first = await captureSourcePlanCatalog(a.db), second = structuredClone(first); second.plans[0]!.title = 'Alternative incoming version';
    const records = await Promise.all([encryptSourcePlanCatalog(keys, first), encryptSourcePlanCatalog(keys, second)]);
    const expected = await captureSourcePlanCatalog(b.db), other = new ProtocolDB(b.db.name);
    try {
      const results = await Promise.allSettled([
        applySourcePlanCatalog(b.db, keys, records[0]!, expected), applySourcePlanCatalog(other, keys, records[1]!, expected),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
      expect(failure.reason.message).toBe('source_plan_local_conflict');
      expect([first, second]).toContainEqual(await captureSourcePlanCatalog(b.db));
    } finally { other.close(); }
  });

  it('refuses authenticated but malformed envelopes, mixed owners and dangling item references', async () => {
    const code = newCode(), keys = await keysFor(code), a = await device(code), b = await device(code, false);
    const catalog = await captureSourcePlanCatalog(a.db), expected = await captureSourcePlanCatalog(b.db);
    const good = { protocol: 2, kind: 'source-plan-catalog', vaultId: keys.vaultId, catalog };
    const mixed = structuredClone(catalog); mixed.items[0]!.personId = 'another-person';
    const wrongOwner = structuredClone(catalog);
    for (const p of wrongOwner.plans) p.personId = 'another-person';
    for (const i of wrongOwner.items) i.personId = 'another-person';
    for (const m of wrongOwner.migrations) { m.personId = 'another-person'; m.legacySnapshot.personId = 'another-person'; }
    const orphan = structuredClone(catalog); orphan.items[0]!.planId = 'absent';
    const k = await recordKey(keys, 'sourcePlans:catalog:v1');
    for (const payload of [null, { ...good, protocol: 1 }, { ...good, vaultId: 'foreign' }, { ...good, extra: true },
      { ...good, catalog: mixed }, { ...good, catalog: wrongOwner }, { ...good, catalog: orphan }]) {
      await expect(applySourcePlanCatalog(b.db, keys, { k, v: await seal(keys, k, payload) }, expected)).rejects.toThrow();
      expect(await b.db.carePlans.count()).toBe(0); expect(await b.db.carePlanItems.count()).toBe(0);
      expect((await b.db.meta.get('sync'))!.seq).toBe(7);
    }
  });

  it('rolls back every catalog store on write failure and permits an explicit retry', async () => {
    const code = newCode(), keys = await keysFor(code), a = await device(code), b = await device(code);
    await b.db.carePlans.update((await b.db.carePlans.toArray())[0]!.id, { title: 'Keep target on failure' });
    const record = await encryptSourcePlanCatalog(keys, await captureSourcePlanCatalog(a.db));
    const before = await sourcePlanBackup(b.db), expected = await captureSourcePlanCatalog(b.db);
    const fail = () => { throw new Error('synthetic_transport_failure'); }; b.db.carePlanItems.hook('creating', fail);
    await expect(applySourcePlanCatalog(b.db, keys, record, expected)).rejects.toThrow('synthetic_transport_failure');
    expect(await sourcePlanBackup(b.db)).toEqual(before);
    b.db.carePlanItems.hook('creating').unsubscribe(fail);
    await applySourcePlanCatalog(b.db, keys, record, expected);
    expect(await captureSourcePlanCatalog(b.db)).toEqual(await captureSourcePlanCatalog(a.db));
  });
});
