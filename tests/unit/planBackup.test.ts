import { afterEach, describe, expect, it } from 'vitest';
import { ProtocolDB } from '../../src/data/db';
import { prepareLegacyPlanCore, readPreparedPlans } from '../../src/data/carePlans';
import { exportAll, importAll, parseExport } from '../../src/data/backup';
import { profileDatabase } from '../../src/data/profiles';
import { emptyPlan } from '../../src/data/seed.example';
const databases: ProtocolDB[] = [];
const make = async (question = 'Synthetic question') => {
  const personId = crypto.randomUUID(), db = new ProtocolDB(profileDatabase(personId)); databases.push(db);
  await db.plan.put({ ...emptyPlan(), id: 'main', questions: [question], prescriptions: [{ id: 'med', kind: 'medication', title: 'Synthetic instruction', dose: '1 таб.', source: 'Synthetic source', schedule: { times: ['10:00'] } }] });
  return { db, personId };
};
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });
describe('source-plan backup compatibility', () => {
  it('keeps v2 for ordinary journals and requires v3 when normalized data exists', async () => {
    const { db, personId } = await make(); expect((await exportAll(db)).version).toBe(2);
    await db.profile.put({ key: 'self', jpeg: 'synthetic-local-photo' });
    await db.reviewDrafts.put({ id: 'plan-review', v: 1, revision: 'private-review', at: '', lines: [], cuts: {}, source: '', note: '' });
    await prepareLegacyPlanCore(db, personId);
    const file = parseExport(JSON.stringify(await exportAll(db)));
    expect(file.version).toBe(3); expect(file.sourcePlans?.plans).toHaveLength(1);
    expect(JSON.stringify(file)).not.toContain('synthetic-local-photo'); expect(JSON.stringify(file)).not.toContain('private-review');
  });
  it('restores into another device-local profile without changing stable ids, source payloads or the original device', async () => {
    const a = await make(), b = await make('Other device'), untouched = await make('Other person');
    await prepareLegacyPlanCore(a.db, a.personId);
    await a.db.entries.put({ id: 'water', at: '2026-10-27T10:00:00Z', kind: 'water', title: 'Вода', waterMl: 250, status: 'done' });
    const original = await readPreparedPlans(a.db, a.personId), file = parseExport(JSON.stringify(await exportAll(a.db)));
    await importAll(file, b.db);
    const restored = await readPreparedPlans(b.db, b.personId);
    expect(restored.map(p => p.plan.id)).toEqual(original.map(p => p.plan.id));
    expect(restored[0]!.items.map(i => i.id)).toEqual(original[0]!.items.map(i => i.id));
    expect(restored[0]!.items.map(i => i.content)).toEqual(original[0]!.items.map(i => i.content));
    expect(restored[0]!.items.every(i => i.personId === b.personId)).toBe(true);
    expect((await b.db.planMigrations.toArray())[0]!.legacySnapshot.personId).toBe(b.personId);
    expect(await prepareLegacyPlanCore(b.db, b.personId)).toBe('unchanged');
    expect(await readPreparedPlans(a.db, a.personId)).toEqual(original);
    expect((await untouched.db.plan.get('main'))?.questions).toEqual(['Other person']);
    await importAll(file, b.db); expect(await b.db.carePlans.count()).toBe(1); expect(await b.db.entries.count()).toBe(1);
  });
  it('rejects mixed owners, dangling items, duplicate ids and missing recovery references before touching the target', async () => {
    const a = await make(), b = await make('Keep target'); await prepareLegacyPlanCore(a.db, a.personId);
    const file = await exportAll(a.db), before = await exportAll(b.db);
    for (const mutate of [
      (f: typeof file) => { f.sourcePlans!.items[0]!.personId = 'foreign-person'; },
      (f: typeof file) => { f.sourcePlans!.items[0]!.planId = 'missing-plan'; },
      (f: typeof file) => { f.sourcePlans!.plans.push({ ...f.sourcePlans!.plans[0]! }); },
      (f: typeof file) => { f.sourcePlans!.migrations[0]!.legacySnapshot.planId = 'missing-plan'; },
    ]) {
      const bad = structuredClone(file); mutate(bad);
      expect(() => parseExport(JSON.stringify(bad))).toThrow('окремі плани');
      await expect(importAll(bad, b.db)).rejects.toThrow('окремі плани');
      const after = await exportAll(b.db); expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
    }
  });
  it('cannot strip normalized data by downgrading a file version or restoring an old format over prepared plans', async () => {
    const a = await make(), b = await make(); const old = await exportAll(a.db);
    await prepareLegacyPlanCore(b.db, b.personId); const before = await exportAll(b.db);
    expect(() => parseExport(JSON.stringify({ ...before, version: 2 }))).toThrow('формату копії 3');
    expect(() => parseExport(JSON.stringify({ ...before, sourcePlans: undefined }))).toThrow('окремі плани');
    await expect(importAll(old, b.db)).rejects.toThrow('не містить окремих планів');
    expect((await exportAll(b.db)).sourcePlans).toEqual(before.sourcePlans);
  });
  it('rolls back both normalized and legacy data if a later journal write fails', async () => {
    const a = await make('Incoming'), b = await make('Keep target');
    await prepareLegacyPlanCore(a.db, a.personId); await prepareLegacyPlanCore(b.db, b.personId);
    await a.db.entries.put({ id: 'water', at: '2026-10-27T10:00:00Z', kind: 'water', title: 'Вода', waterMl: 250, status: 'done' });
    const file = await exportAll(a.db), before = await exportAll(b.db);
    const fail = () => { throw new Error('synthetic_import_failure'); }; b.db.entries.hook('creating', fail);
    await expect(importAll(file, b.db)).rejects.toThrow('synthetic_import_failure');
    b.db.entries.hook('creating').unsubscribe(fail);
    const after = await exportAll(b.db); expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
  });
  it('supports the older retained plan identity after a portable restore', async () => {
    const a = await make(), b = await make(); await prepareLegacyPlanCore(a.db, a.personId);
    const file = await exportAll(a.db), backup = file.sourcePlans!;
    const oldId = JSON.stringify(['legacy-plan', a.personId, 'main']);
    const { expandLegacyPlan } = await import('../../src/domain/carePlans');
    const old = expandLegacyPlan(file.plan, a.personId, oldId);
    backup.plans = old.plans; backup.items = old.items; backup.migrations[0]!.legacySnapshot = old.legacySnapshot;
    await importAll(file, b.db); expect(await prepareLegacyPlanCore(b.db, b.personId)).toBe('unchanged');
    expect((await readPreparedPlans(b.db, b.personId))[0]!.plan.id).toBe(oldId);
  });
});
