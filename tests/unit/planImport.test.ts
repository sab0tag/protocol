import { afterEach, describe, expect, it } from 'vitest';
import { ProtocolDB } from '../../src/data/db';
import { readPreparedPlans, saveClinicImport } from '../../src/data/carePlans';
import { profileDatabase } from '../../src/data/profiles';
import { confirmImport, parseClinicPlan, previewClinicPlan, previewClinicRedemption } from '../../src/domain/planImport';

const plan = () => ({
  schemaVersion: 1, planId: '11111111-1111-4111-8111-111111111111', organizationId: 'org', issuedAt: '2026-10-01T10:00:00+03:00',
  clinician: { displayName: 'Лікар', organizationName: 'Клініка' }, title: 'План',
  medications: [{ name: 'Ліки', dose: '1 таб.', frequency: '2 рази', duration: '7 днів', instructions: 'після їжі' }],
  restrictions: ['Без алкоголю'], tests: ['Загальний аналіз крові'], followUp: 'Візит за 2 тижні',
});

const receipt = () => {
  const p = plan();
  p.clinician = { displayName: 'Actual doctor', organizationName: 'Actual clinic' };
  return { plan: p, snapshot: { schemaVersion: 1, snapshotId: '22222222-2222-4222-8222-222222222222', issuedAt: p.issuedAt,
    issuer: { memberId: 'member', membershipId: 'membership', organizationId: p.organizationId, ...p.clinician },
    source: { planId: p.planId, issuedAt: '2025-01-01T00:00:00Z', clinician: { displayName: 'Claimed doctor', organizationName: 'Claimed clinic' } } } };
};

describe('server redemption provenance', () => {
  it('accepts matching server provenance only through the redemption response parser; file fields cannot certify an issuer', () => {
    const r = receipt(), pv = previewClinicRedemption(r)!;
    expect(pv.snapshot).toEqual(r.snapshot);
    expect(previewClinicPlan(r)).toBeNull();
    expect(previewClinicPlan({ ...r.plan, issuer: r.snapshot.issuer })).toBeNull();
    expect(previewClinicPlan({ ...r.plan, snapshot: r.snapshot })).toBeNull();
    expect(previewClinicPlan({ ...r.plan, clinician: { ...r.plan.clinician, verified: true } })).toBeNull();
    expect(previewClinicPlan(r.plan)!.snapshot).toBeUndefined(); // even the normalized plan alone has no proof
    r.snapshot.issuer.displayName = 'Changed after parsing';
    expect(pv.snapshot!.issuer.displayName).toBe('Actual doctor');
  });
  it('keeps old server responses unverified and rejects malformed or mismatched receipts', () => {
    expect(previewClinicRedemption({ plan: plan() })!.snapshot).toBeUndefined();
    for (const wrong of [null, [], { plan: plan(), snapshot: null }, { ...receipt(), extra: true },
      { ...receipt(), snapshot: { ...receipt().snapshot, snapshotId: 'fake' } },
      { ...receipt(), snapshot: { ...receipt().snapshot, issuedAt: '2024-01-01T00:00:00Z' } },
      { ...receipt(), snapshot: { ...receipt().snapshot, issuer: { ...receipt().snapshot.issuer, organizationId: 'foreign' } } },
      { ...receipt(), snapshot: { ...receipt().snapshot, issuer: { ...receipt().snapshot.issuer, displayName: 'fake' } } },
      { ...receipt(), snapshot: { ...receipt().snapshot, source: { ...receipt().snapshot.source, planId: 'other' } } },
    ]) expect(previewClinicRedemption(wrong)).toBeNull();
  });
  it('stores issuer and declared source separately in the existing draft core; snapshot retries deduplicate, reissues stay separate', async () => {
    const { db, personId } = make(), r = receipt();
    const first = confirmImport(previewClinicRedemption(r)!, ['med:0'], personId)!;
    expect(first.plan.clinicianRef).toBe('Actual doctor, Actual clinic');
    expect(first.plan).toMatchObject({ status: 'draft', source: { kind: 'clinic', clinicPlanId: r.plan.planId, redemption: r.snapshot } });
    expect(first.items[0]!.provenance.verification).toBe('pending'); // author provenance never certifies a dose
    expect(await saveClinicImport(db, personId, first)).toBe('saved');
    expect(await saveClinicImport(db, personId, first)).toBe('already_imported');
    const replacement = receipt(); replacement.snapshot.snapshotId = '33333333-3333-4333-8333-333333333333';
    const second = confirmImport(previewClinicRedemption(replacement)!, ['med:0'], personId)!;
    expect(second.plan.id).not.toBe(first.plan.id);
    expect(await saveClinicImport(db, personId, second)).toBe('saved');
    const rows = await readPreparedPlans(db, personId);
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.plan.status === 'draft' && r.items[0]!.provenance.verification === 'pending')).toBe(true);
    expect(await db.entries.count()).toBe(0);
    expect(await db.plan.count()).toBe(0);
  });
});
const dbs: ProtocolDB[] = [];
const make = () => { const personId = crypto.randomUUID(); const db = new ProtocolDB(profileDatabase(personId)); dbs.push(db); return { db, personId }; };
afterEach(async () => { for (const d of dbs.splice(0)) await d.delete(); });

describe('clinic plan import', () => {
  it('previews every item without storing or activating anything', () => {
    const pv = previewClinicPlan(plan())!;
    expect(pv.items.map((i) => i.key)).toEqual(['med:0', 'rest:0', 'test:0', 'follow']);
    expect(pv.items[0]!.detail).toBe('1 таб. · 2 рази · 7 днів · після їжі');
  });
  it('refuses malformed plans and unknown fields', () => {
    expect(parseClinicPlan(null)).toBeNull();
    expect(parseClinicPlan({ ...plan(), schemaVersion: 2 })).toBeNull();
    expect(parseClinicPlan({ ...plan(), extra: 1 })).toBeNull();
    expect(parseClinicPlan({ ...plan(), medications: [{ name: 'x' }] })).toBeNull();
    expect(parseClinicPlan({ ...plan(), issuedAt: 'not a date' })).toBeNull();
    expect(parseClinicPlan({ ...plan(), medications: [{ ...plan().medications[0], extra: 1 }] })).toBeNull();
  });
  it('imports only ticked items, as an unverified draft with its source, with no schedule or start date', () => {
    const pv = previewClinicPlan(plan())!, personId = 'p1';
    expect(confirmImport(pv, [], personId)).toBeNull();
    expect(confirmImport(pv, ['nope'], personId)).toBeNull();
    const d = confirmImport(pv, ['med:0', 'test:0'], personId)!;
    expect(d.plan).toMatchObject({ status: 'draft', source: { kind: 'clinic', organizationName: 'Клініка' } });
    expect(d.items).toHaveLength(2);
    for (const it of d.items) {
      expect(it.provenance.verification).toBe('pending');
      expect(it.content.type === 'prescription' && it.content.value.schedule).toBeFalsy();
      expect(it.content.type === 'prescription' && it.content.value.since).toBeFalsy();
    }
  });
  it('stores locally once; a second import of the same plan changes nothing', async () => {
    const { db, personId } = make();
    const d = confirmImport(previewClinicPlan(plan())!, ['med:0', 'rest:0'], personId)!;
    expect(await saveClinicImport(db, personId, d)).toBe('saved');
    expect(await saveClinicImport(db, personId, d)).toBe('already_imported');
    const stored = await readPreparedPlans(db, personId);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.items).toHaveLength(2);
  });
  it('refuses to write another person\'s plan', async () => {
    const { db, personId } = make();
    const d = confirmImport(previewClinicPlan(plan())!, ['med:0'], 'someone-else')!;
    await expect(saveClinicImport(db, personId, d)).rejects.toThrow('plan_database_owner_mismatch');
  });
});
