import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { ClinicDirectory } from '../src/clinic/directory.ts';
import { PlanDelivery } from '../src/clinic/delivery.ts';
import { MIGRATIONS, assertCurrent, migrate } from '../src/db/migrate.ts';
import { Store } from '../src/store.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
const rig = () => {
  const store = Store.migrated(':memory:'); stores.push(store);
  const db = store.database, now = () => Date.parse('2026-10-29T10:00:00Z');
  const dir = new ClinicDirectory(db, now), delivery = new PlanDelivery(db, dir, now);
  const org = dir.createOrganization('Actual clinic', 'Admin'), admin = dir.authenticate(org.token)!;
  const staff = dir.addStaff(admin, { displayName: 'Actual issuing doctor', role: 'doctor' });
  const actor = dir.authenticate(staff.token)!;
  const plan = { schemaVersion: 1, planId: randomUUID(), organizationId: org.orgId, issuedAt: '2025-01-01T00:00:00Z',
    clinician: { displayName: 'Claimed source doctor', organizationName: 'Claimed source clinic' }, title: 'Synthetic',
    medications: [{ name: 'Synthetic medication', dose: '1 unit', frequency: 'daily', duration: '', instructions: '' }], restrictions: [], tests: [] };
  return { store, db, dir, delivery, org, actor, staff, plan, now };
};

describe('ACCESS-07-A server snapshots', () => {
  it('does not issue an unusable snapshot when stored issuer data is invalid', () => {
    const { db, delivery, actor, plan } = rig();
    db.prepare("UPDATE clinic_members SET name = '' WHERE id = ?").run(actor.memberId);
    const before = db.prepare('SELECT * FROM clinic_audit').all();
    expect(() => delivery.issue(actor, { plan, patientConsent: true })).toThrow('bad_request');
    expect(db.prepare('SELECT COUNT(*) AS n FROM plan_delivery').get()?.n).toBe(0);
    expect(db.prepare('SELECT * FROM clinic_audit').all()).toEqual(before);
  });
  it('uses live server identity/time, preserving the declared source separately; input mutation cannot rewrite the snapshot', () => {
    const { db, delivery, actor, org, plan } = rig();
    const declared = structuredClone(plan);
    const issued = delivery.issue(actor, { plan, patientConsent: true });
    const before = db.prepare('SELECT plan, plan_hash, format FROM plan_delivery WHERE id = ?').get(issued.deliveryId)!;
    expect(before.format).toBe(2); expect(sha(before.plan as string)).toBe(before.plan_hash);
    plan.title = 'Changed input'; plan.clinician.displayName = 'Another source';
    db.prepare('UPDATE clinic_members SET name = ? WHERE id = ?').run('Renamed doctor', actor.memberId);
    db.prepare('UPDATE clinic_orgs SET name = ? WHERE id = ?').run('Renamed clinic', org.orgId);
    expect(db.prepare('SELECT plan, plan_hash, format FROM plan_delivery WHERE id = ?').get(issued.deliveryId)).toEqual(before);
    const redeemed = delivery.redeemWithProvenance(issued.code);
    expect(redeemed.plan).toEqual({ ...declared, issuedAt: '2026-10-29T10:00:00.000Z',
      clinician: { displayName: 'Actual issuing doctor', organizationName: 'Actual clinic' } });
    expect(redeemed.snapshot).toEqual({ schemaVersion: 1, snapshotId: issued.deliveryId, issuedAt: redeemed.plan.issuedAt,
      issuer: { memberId: actor.memberId, membershipId: actor.memberId, organizationId: org.orgId,
        displayName: 'Actual issuing doctor', organizationName: 'Actual clinic' },
      source: { planId: declared.planId, issuedAt: declared.issuedAt, clinician: declared.clinician } });
    expect(db.prepare('SELECT plan FROM plan_delivery WHERE id = ?').get(issued.deliveryId)?.plan).toBeNull();
    const audit = JSON.stringify(db.prepare('SELECT * FROM clinic_audit').all());
    expect(audit).not.toMatch(/Claimed source|Actual issuing doctor|Synthetic medication/);
  });
  it('reissuing the same client plan creates a different server snapshot; the old pending document remains unchanged', () => {
    const { db, delivery, actor, plan } = rig();
    const first = delivery.issue(actor, { plan, patientConsent: true });
    const old = db.prepare('SELECT * FROM plan_delivery WHERE id = ?').get(first.deliveryId);
    const second = delivery.issue(actor, { plan: { ...plan, title: 'Replacement' }, patientConsent: true });
    expect(second.deliveryId).not.toBe(first.deliveryId);
    expect(db.prepare('SELECT * FROM plan_delivery WHERE id = ?').get(first.deliveryId)).toEqual(old);
    expect(delivery.redeemWithProvenance(first.code).snapshot?.snapshotId).toBe(first.deliveryId);
    expect(delivery.redeemWithProvenance(second.code).snapshot?.snapshotId).toBe(second.deliveryId);
  });
  it('uses the actual membership ID when it differs from the preserved staff author ID', () => {
    const { db, delivery, actor, plan } = rig();
    db.prepare('DELETE FROM organization_membership_roles WHERE membership_id = ?').run(actor.memberId);
    db.prepare("UPDATE organization_memberships SET id = 'linked-member' WHERE id = ?").run(actor.memberId);
    db.exec("INSERT INTO organization_membership_roles VALUES ('linked-member', 'doctor')");
    const issued = delivery.issue(actor, { plan, patientConsent: true });
    expect(delivery.redeemWithProvenance(issued.code).snapshot?.issuer).toMatchObject({ memberId: actor.memberId, membershipId: 'linked-member' });
  });
  it('cannot accept a client-issued snapshot/issuer; extra top-level request claims never override the server', async () => {
    const { store, dir, delivery, staff, plan, actor } = rig();
    const app = createApp({ store, origins: [], clinic: dir, planDelivery: delivery });
    const issue = (body: unknown) => app.request('/v1/clinic/plans', { method: 'POST', headers: {
      Authorization: `Bearer ${staff.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await issue({ plan: { ...plan, issuer: { displayName: 'Forged' } }, patientConsent: true })).status).toBe(400);
    expect((await issue({ plan: { ...plan, clinician: { ...plan.clinician, verified: true } }, patientConsent: true })).status).toBe(400);
    expect((await issue({ plan: { ...plan, medications: [{ ...plan.medications[0], unknownInstruction: 'must not disappear' }] }, patientConsent: true })).status).toBe(400);
    const response = await issue({ plan, patientConsent: true, issuer: { memberId: 'forged', displayName: 'Forged' } });
    expect(response.status).toBe(201);
    const { code } = await response.json() as { code: string };
    const got = await app.request('/v1/clinic/plans/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    expect(got.status).toBe(200); expect(got.headers.get('cache-control')).toBe('no-store');
    expect(await got.json()).toMatchObject({ plan: { clinician: { displayName: 'Actual issuing doctor' } }, snapshot: { issuer: { memberId: actor.memberId } } });
  });
  for (const field of ['snapshotId', 'memberId', 'organizationId', 'issuedAt', 'clinician'] as const) {
    it(`rejects inconsistent snapshot ${field} even with a recomputed payload hash`, () => {
      const { db, delivery, actor, plan } = rig();
      const issued = delivery.issue(actor, { plan, patientConsent: true });
      const row = db.prepare('SELECT plan FROM plan_delivery WHERE id = ?').get(issued.deliveryId)!;
      const snapshot = JSON.parse(row.plan as string);
      if (field === 'snapshotId') snapshot.snapshotId = randomUUID();
      if (field === 'memberId') snapshot.issuer.memberId = randomUUID();
      if (field === 'organizationId') snapshot.issuer.organizationId = randomUUID();
      if (field === 'issuedAt') snapshot.issuedAt = '2026-01-01T00:00:00Z';
      if (field === 'clinician') snapshot.plan.clinician.displayName = 'Replaced';
      const body = JSON.stringify(snapshot);
      db.prepare('UPDATE plan_delivery SET plan = ?, plan_hash = ? WHERE id = ?').run(body, sha(body), issued.deliveryId);
      expect(() => delivery.redeemWithProvenance(issued.code)).toThrow('tampered');
      expect(() => delivery.redeemWithProvenance(issued.code)).toThrow('tampered');
      expect(db.prepare('SELECT status, plan FROM plan_delivery WHERE id = ?').get(issued.deliveryId)).toEqual({ status: 'tampered', plan: null });
      expect(db.prepare("SELECT COUNT(*) AS n FROM clinic_audit WHERE action LIKE 'plan.tampered.%'").get()?.n).toBe(1);
    });
  }
});

it('migration 3 preserves existing payloads/hash/IDs and never certifies a legacy delivery; older builds refuse the new schema', () => {
  const db = new DatabaseSync(':memory:');
  try {
    expect(MIGRATIONS()[1]!.checksum).toBe('45e003fee6471dc5cdcb0d2b3506a52cf925db2bc88e7716ea9a52012c7e94e0');
    migrate(db, MIGRATIONS().slice(0, 2));
    const dir = new ClinicDirectory(db), org = dir.createOrganization('Legacy clinic', 'Admin');
    const legacy = { schemaVersion: 1, planId: randomUUID(), organizationId: org.orgId, issuedAt: '2025-01-01T00:00:00Z',
      clinician: { displayName: 'Unknown historical source', organizationName: 'Claimed clinic' }, title: 'Legacy', medications: [], restrictions: [], tests: [] };
    const code = 'l'.repeat(43), payload = JSON.stringify(legacy);
    db.prepare('INSERT INTO plan_delivery VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('old-delivery', org.orgId, org.adminId, sha(code), payload, sha(payload), Date.now() + 60_000, 'pending', 100);
    const before = db.prepare('SELECT * FROM plan_delivery').get()!;
    expect(migrate(db).applied).toEqual([3]);
    expect(db.prepare('SELECT * FROM plan_delivery').get()).toEqual({ ...before, format: 1 });
    expect(migrate(db).applied).toEqual([]);
    expect(() => assertCurrent(db, MIGRATIONS().slice(0, 2))).toThrow('newer_schema');
    const got = new PlanDelivery(db, dir).redeemWithProvenance(code);
    expect(got).toEqual({ plan: legacy });
    expect(got.snapshot).toBeUndefined();
  } finally { db.close(); }
});
