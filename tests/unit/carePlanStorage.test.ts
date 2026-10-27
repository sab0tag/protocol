import Dexie from 'dexie';
import { V10_STORES } from '../fixtures/schemaV10';
import { afterEach, describe, expect, it } from 'vitest';
import { ProtocolDB } from '../../src/data/db';
import { prepareLegacyPlanCore, readPreparedPlans } from '../../src/data/carePlans';
import { profileDatabase } from '../../src/data/profiles';
import { emptyPlan } from '../../src/data/seed.example';
import type { PlanRow } from '../../src/data/db';
const databases: ProtocolDB[] = [];
const make = () => { const personId = crypto.randomUUID(); const db = new ProtocolDB(profileDatabase(personId)); databases.push(db); return { db, personId }; };
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });
const legacy = (): PlanRow => ({ ...emptyPlan(), id: 'main', questions: ['Synthetic question'],
  prescriptions: [{ id: 'med', kind: 'medication', title: 'Synthetic instruction', source: 'Synthetic source', dose: '1 таб.', schedule: { times: ['10:00'] }, since: '2026-10-27' }],
  targets: { waterMl: 2000 },
});

describe('R5 expand-only storage', () => {
  it('upgrades an actual v10 database, retains the journal/photo/review and reopens without migration writes', async () => {
    const { db, personId } = make(), original = legacy();
    const old = new Dexie(db.name); old.version(10).stores(V10_STORES);
    await old.table('plan').put(original);
    await old.table('entries').put({ id: 'water', kind: 'water', at: '2026-10-27T10:00:00Z', waterMl: 250 });
    await old.table('profile').put({ key: 'self', jpeg: 'synthetic-photo' });
    await old.table('reviewDrafts').put({ id: 'plan-review', revision: 'synthetic-review' }); old.close();
    await db.open(); expect(db.verno).toBe(11);
    // Opening the new schema alone never enables the new model.
    expect(await db.carePlans.count()).toBe(0); expect(await db.planMigrations.count()).toBe(0);
    expect(await prepareLegacyPlanCore(db, personId)).toBe('created');
    const prepared = await readPreparedPlans(db, personId), markers = await db.planMigrations.toArray();
    expect(prepared).toHaveLength(1); expect(prepared[0]!.items).toHaveLength(2);
    expect(markers[0]!.legacySnapshot.record).toEqual(original);
    db.close(); await db.open();
    expect(await prepareLegacyPlanCore(db, personId)).toBe('unchanged');
    expect(await readPreparedPlans(db, personId)).toEqual(prepared); expect(await db.planMigrations.toArray()).toEqual(markers);
    expect(await db.plan.get('main')).toEqual(original); expect((await db.entries.get('water'))?.waterMl).toBe(250);
    expect((await db.profile.get('self'))?.jpeg).toBe('synthetic-photo');
    expect((await db.reviewDrafts.get('plan-review'))?.revision).toBe('synthetic-review');
    // Reverting app code to the old expand-compatible schema must not delete either representation.
    db.close(); await old.open();
    expect(await old.table('plan').get('main')).toEqual(original);
    expect(Array.from(old.backendDB().objectStoreNames)).toContain('carePlans');
    old.close(); await db.open(); expect(await readPreparedPlans(db, personId)).toEqual(prepared);
  });
  it('rolls back all prepared records on a failed item write and retries without touching the original', async () => {
    const { db, personId } = make(), original = legacy(); await db.plan.put(original);
    const fail = () => { throw new Error('synthetic_storage_failure'); };
    db.carePlanItems.hook('creating', fail);
    await expect(prepareLegacyPlanCore(db, personId)).rejects.toThrow('synthetic_storage_failure');
    expect(await db.carePlans.count()).toBe(0); expect(await db.carePlanItems.count()).toBe(0); expect(await db.planMigrations.count()).toBe(0);
    expect(await db.plan.get('main')).toEqual(original);
    db.carePlanItems.hook('creating').unsubscribe(fail);
    expect(await prepareLegacyPlanCore(db, personId)).toBe('created');
  });
  it('serializes two concurrent preparations instead of duplicating or replacing identities', async () => {
    const { db, personId } = make(); await db.plan.put(legacy());
    const other = new ProtocolDB(db.name);
    try {
      expect((await Promise.all([prepareLegacyPlanCore(db, personId), prepareLegacyPlanCore(other, personId)])).sort()).toEqual(['created', 'unchanged']);
      expect(await db.carePlans.count()).toBe(1); expect(await db.carePlanItems.count()).toBe(2); expect(await db.planMigrations.count()).toBe(1);
    } finally { other.close(); }
  });
  it('reports a changed source without overwriting its prepared version or altering the current journal', async () => {
    const { db, personId } = make(), original = legacy(); await db.plan.put(original); await prepareLegacyPlanCore(db, personId);
    const prepared = await readPreparedPlans(db, personId), marker = await db.planMigrations.toArray();
    // Key order is not a change to an instruction.
    const { targets, ...rest } = original;
    await db.plan.put({ targets, ...rest });
    expect(await prepareLegacyPlanCore(db, personId)).toBe('unchanged');
    const changed = { ...original, questions: ['Changed question'], prescriptions: [{ ...original.prescriptions[0]!, dose: '2 таб.' }] };
    await db.plan.put(changed); expect(await prepareLegacyPlanCore(db, personId)).toBe('source_changed');
    expect(await db.plan.get('main')).toEqual(changed); expect(await readPreparedPlans(db, personId)).toEqual(prepared);
    expect(await db.planMigrations.toArray()).toEqual(marker);
  });
  it('rejects the wrong owner and corrupted/partial preparations without reconstructing over existing records', async () => {
    const { db, personId } = make(); await db.plan.put(legacy());
    await expect(prepareLegacyPlanCore(db, 'main')).rejects.toThrow('plan_database_owner_mismatch');
    expect(await db.carePlans.count()).toBe(0);
    await prepareLegacyPlanCore(db, personId);
    const item = (await db.carePlanItems.toArray())[0]!; await db.carePlanItems.delete(item.id);
    await expect(prepareLegacyPlanCore(db, personId)).rejects.toThrow('plan_migration_inconsistent');
    expect(await db.carePlanItems.get(item.id)).toBeUndefined();
    await db.carePlanItems.put({ ...item, personId: 'someone-else' });
    await expect(readPreparedPlans(db, personId)).rejects.toThrow('plan_database_owner_mismatch');
  });
  it('does not invent a plan when the legacy record is absent', async () => {
    const { db, personId } = make(); expect(await prepareLegacyPlanCore(db, personId)).toBe('no_legacy_plan');
    expect(await db.planMigrations.count()).toBe(0); expect(await readPreparedPlans(db, personId)).toEqual([]);
  });
});
