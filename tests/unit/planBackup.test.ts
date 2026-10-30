import { afterEach, describe, expect, it } from 'vitest';
import { ProtocolDB } from '../../src/data/db';
import { prepareLegacyPlanCore, readPreparedPlans, saveClinicImport } from '../../src/data/carePlans';
import { confirmImport, previewClinicPlan, previewClinicRedemption } from '../../src/domain/planImport';
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
const clinicPlan = () => ({ schemaVersion: 1, planId: 'synthetic-clinic-plan', organizationId: 'clinic', issuedAt: '2026-10-30T10:00:00Z',
  clinician: { displayName: 'Synthetic doctor', organizationName: 'Synthetic clinic' }, title: 'Synthetic care plan',
  medications: [{ name: 'Synthetic medicine', dose: '1 unit', frequency: 'Once daily', duration: '7 days', instructions: 'Check with doctor' }],
  restrictions: ['Synthetic restriction'], tests: ['Synthetic test'] });
const clinicPreview = (withReceipt: boolean) => {
  const plan = clinicPlan();
  return withReceipt ? previewClinicRedemption({ plan, snapshot: { schemaVersion: 1,
    snapshotId: '22222222-2222-4222-8222-222222222222', issuedAt: plan.issuedAt,
    issuer: { memberId: 'doctor', membershipId: 'membership', organizationId: plan.organizationId, ...plan.clinician },
    source: { planId: plan.planId, issuedAt: '2026-10-29T10:00:00Z', clinician: { displayName: 'Declared doctor', organizationName: 'Declared clinic' } },
  } })! : previewClinicPlan(plan)!;
};
describe('source-plan backup compatibility', () => {
  for (const withReceipt of [false, true]) it(`round-trips a clinic draft with receipt=${withReceipt} without activating it or changing source identities`, async () => {
    const a = await make(), b = await make('Restore target'), other = await make('Unrelated person');
    await prepareLegacyPlanCore(a.db, a.personId);
    const draft = confirmImport(clinicPreview(withReceipt), ['med:0', 'rest:0', 'test:0'], a.personId)!;
    await saveClinicImport(a.db, a.personId, draft);
    const original = await readPreparedPlans(a.db, a.personId);
    const file = parseExport(JSON.stringify(await exportAll(a.db)));
    expect(file.version).toBe(3); expect(file.sourcePlans!.plans).toHaveLength(2);
    await importAll(file, b.db);
    const restored = await readPreparedPlans(b.db, b.personId);
    expect(restored).toEqual(original.map(({ plan, items }) => ({ plan: { ...plan, personId: b.personId }, items: items.map(item => ({ ...item, personId: b.personId })) })));
    const clinic = restored.find(row => row.plan.source.kind === 'clinic')!;
    expect(clinic.plan.status).toBe('draft');
    expect(clinic.items.every(item => item.provenance.verification === 'pending')).toBe(true);
    expect(clinic.items.every(item => item.content.type === 'prescription' && !item.content.value.schedule && !item.content.value.since)).toBe(true);
    expect(await b.db.entries.count()).toBe(0);
    expect((await exportAll(b.db)).sourcePlans!.plans.find(p => p.source.kind === 'clinic')!.source).toEqual(draft.plan.source);
    await importAll(file, b.db); expect(await b.db.carePlans.count()).toBe(2);
    expect(await readPreparedPlans(a.db, a.personId)).toEqual(original);
    expect((await other.db.plan.get('main'))?.questions).toEqual(['Unrelated person']);
    // Restoring historical metadata cannot enable a new redemption or upgrade file-import authorship.
    expect(previewClinicPlan({ ...clinicPlan(), snapshot: withReceipt ? clinicPreview(true).snapshot : {} })).toBeNull();
  });
  it('rejects malformed clinic sources and receipts before replacing the restore target', async () => {
    const a = await make(), b = await make('Keep target');
    await saveClinicImport(a.db, a.personId, confirmImport(clinicPreview(true), ['med:0'], a.personId)!);
    const file = await exportAll(a.db), before = await exportAll(b.db);
    const mutations: ((s: Record<string, any>) => void)[] = [
      s => { s.clinicPlanId = ''; }, s => { s.organizationName = ''; }, s => { s.issuedAt = 'not-a-date'; },
      s => { s.extra = true; }, s => { s.redemption = null; }, s => { s.redemption.schemaVersion = 2; },
      s => { s.redemption.snapshotId = 'invalid'; }, s => { s.redemption.source.planId = 'another-plan'; },
      s => { s.redemption.issuer.organizationName = 'another-clinic'; }, s => { s.redemption.issuedAt = '2026-01-01T00:00:00Z'; },
      s => { s.redemption.issuer.memberId = ''; }, s => { s.redemption.source.clinician.displayName = ''; },
      s => { s.redemption.issuer.extra = true; }, s => { s.redemption.source.issuedAt = 'invalid'; },
    ];
    for (const mutate of mutations) {
      const bad = structuredClone(file); mutate(bad.sourcePlans!.plans[0]!.source);
      expect(() => parseExport(JSON.stringify(bad))).toThrow('окремі плани');
      await expect(importAll(bad, b.db)).rejects.toThrow('окремі плани');
      const after = await exportAll(b.db); expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
    }
  });
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
