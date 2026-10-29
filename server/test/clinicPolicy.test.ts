import { afterEach, describe, expect, it } from 'vitest';
import { ClinicDirectory, type Actor } from '../src/clinic/directory.ts';
import { ClinicPolicy, decide, type PolicySubject, type Resource } from '../src/clinic/policy.ts';
import { PlanDelivery } from '../src/clinic/delivery.ts';
import { Store } from '../src/store.ts';

const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
function rig() {
  const store = Store.migrated(':memory:'); stores.push(store);
  const db = store.database, dir = new ClinicDirectory(db), policy = new ClinicPolicy(db);
  const org = dir.createOrganization('Synthetic A', 'Admin');
  const other = dir.createOrganization('Synthetic B', 'Other admin');
  const admin = dir.authenticate(org.token)!;
  const staff = dir.addStaff(admin, { displayName: 'Doctor', role: 'doctor' });
  const doctor = dir.authenticate(staff.token)!;
  const colleague = dir.authenticate(dir.addStaff(admin, { displayName: 'Colleague', role: 'doctor' }).token)!;
  const delivery = new PlanDelivery(db, dir);
  const plan = { schemaVersion: 1, planId: crypto.randomUUID(), organizationId: org.orgId,
    issuedAt: '2026-10-29T12:00:00Z', clinician: { displayName: 'Synthetic', organizationName: 'Synthetic A' }, title: 'Synthetic',
    medications: [], restrictions: [], tests: [] };
  const input = { plan, patientConsent: true };
  const subject: PolicySubject = { kind: 'membership', accountId: doctor.memberId, membershipId: doctor.memberId, orgId: org.orgId };
  return { store, db, dir, policy, org, other, admin, doctor, colleague, staff, subject, delivery, input };
}
const organization = (orgId: string): Resource => ({ kind: 'organization', orgId });
const own = { kind: 'delivery', orgId: 'a', authorMemberId: 'doctor' } as const;

describe('object policy matrix', () => {
  for (const roles of [[], ['admin'], ['doctor'], ['admin', 'doctor']] as readonly (readonly ('admin' | 'doctor')[])[]) {
    it(`enforces role, tenant, author and resource boundaries for roles ${roles.join('+') || 'none'}`, () => {
      const actor = { orgId: 'a', authorMemberId: 'doctor', roles };
      expect(decide(actor, 'staff.manage', organization('a'))).toBe(roles.includes('admin') ? null : 'forbidden');
      expect(decide(actor, 'org.stats.read', organization('a'))).toBe(roles.includes('admin') ? null : 'forbidden');
      expect(decide(actor, 'plan.issue', organization('a'))).toBe(roles.includes('doctor') ? null : 'forbidden');
      for (const action of ['delivery.status.read_own', 'delivery.revoke_own']) {
        expect(decide(actor, action, own)).toBe(roles.includes('doctor') ? null : 'forbidden');
        expect(decide(actor, action, { ...own, authorMemberId: 'colleague' })).toBe(roles.includes('doctor') ? 'not_found' : 'forbidden');
        expect(decide(actor, action, { ...own, orgId: 'b' })).toBe('not_found');
        expect(decide(actor, action, organization('a'))).not.toBeNull();
      }
      for (const action of ['report.snapshot.read', 'measurements.read', 'adherence.read', '*', 'unknown']) {
        expect(decide(actor, action, organization('a'))).toBe('forbidden');
      }
      expect(decide(actor, 'staff.manage', own)).toBe('forbidden');
      expect(decide(actor, 'plan.issue', { kind: 'staff', orgId: 'a' })).toBe('forbidden');
    });
  }
  it('requires own draft for both old and canonical permission names', () => {
    const actor = { orgId: 'a', authorMemberId: 'doctor', roles: ['doctor'] as const };
    for (const action of ['plan.edit_own_draft', 'plan.draft.edit_own']) {
      expect(decide(actor, action, { ...own, kind: 'draft' })).toBeNull();
      expect(decide(actor, action, { ...own, kind: 'draft', authorMemberId: 'other' })).toBe('not_found');
      expect(decide(actor, action, own)).toBe('not_found');
    }
  });
});

describe('live legacy and membership authority', () => {
  for (const disabled of ['account', 'membership'] as const) it(`does not count an admin with a disabled ${disabled} as the remaining admin`, () => {
    const { dir, db, admin, org } = rig();
    const peer = dir.addStaff(admin, { displayName: 'Disabled admin', role: 'admin' });
    if (disabled === 'account') db.prepare("UPDATE accounts SET status = 'disabled' WHERE id = ?").run(peer.memberId);
    else db.prepare("UPDATE organization_memberships SET status = 'inactive' WHERE id = ?").run(peer.memberId);
    const before = db.prepare('SELECT * FROM clinic_audit').all();
    expect(() => dir.deactivate(admin, org.adminId)).toThrow('last_admin');
    expect(() => dir.setRole(admin, org.adminId, 'doctor')).toThrow('last_admin');
    expect(db.prepare('SELECT * FROM clinic_audit').all()).toEqual(before);
    expect(dir.profile(admin).role).toBe('admin');
  });
  it('uses the live legacy role, ignoring forged/cached Actor role and additive role sets', () => {
    const { dir, db, doctor, admin } = rig();
    db.prepare('INSERT INTO organization_membership_roles VALUES (?, ?)').run(doctor.memberId, 'admin');
    expect(() => dir.require({ ...doctor, role: 'admin' }, 'staff.manage')).toThrow('forbidden');
    expect(() => dir.require({ ...admin, role: 'doctor' }, 'plan.issue')).toThrow('forbidden');
    dir.setRole(admin, doctor.memberId, 'admin');
    expect(() => dir.require(doctor, 'plan.issue')).toThrow('forbidden');
    expect(() => dir.require(doctor, 'staff.manage')).not.toThrow();
  });
  it('denies pending accounts on the future membership path, while preserving provisional legacy login', () => {
    const { dir, policy, subject, doctor, org, staff } = rig();
    expect(dir.authenticate(staff.token)).toEqual(doctor);
    expect(() => policy.require(subject, 'plan.issue', organization(org.orgId))).toThrow('unauthenticated');
  });
  it('combines an active membership role set without granting patient data or other authors deliveries', () => {
    const { db, policy, subject, org, doctor, dir } = rig();
    db.prepare("UPDATE accounts SET status = 'active' WHERE id = ?").run(doctor.memberId);
    db.prepare('INSERT INTO organization_membership_roles VALUES (?, ?)').run(doctor.memberId, 'admin');
    for (const action of ['plan.issue', 'staff.manage', 'org.stats.read'] as const) {
      expect(() => policy.require(subject, action, organization(org.orgId))).not.toThrow();
    }
    expect(() => policy.require(subject, 'delivery.status.read_own', { kind: 'delivery', orgId: org.orgId, authorMemberId: doctor.memberId })).not.toThrow();
    expect(() => policy.require(subject, 'delivery.revoke_own', { kind: 'delivery', orgId: org.orgId, authorMemberId: 'other' })).toThrow('not_found');
    // A role is read again, never cached in the authenticated subject.
    db.prepare("DELETE FROM organization_membership_roles WHERE membership_id = ? AND role = 'doctor'").run(doctor.memberId);
    expect(() => policy.require(subject, 'plan.issue', organization(org.orgId))).toThrow('forbidden');
    expect(() => policy.require(subject, 'staff.manage', organization(org.orgId))).not.toThrow();
    // SQL role-set changes must not widen old bearer authority.
    expect(() => dir.require(doctor, 'staff.manage')).toThrow('forbidden');
  });
  it('binds exact account, membership and organization; one person does not inherit another membership authority', () => {
    const { db, policy, subject, other, doctor, org } = rig();
    db.prepare("UPDATE accounts SET status = 'active' WHERE id = ?").run(doctor.memberId);
    db.prepare("INSERT INTO organization_memberships (id, account_id, organization_id, legacy_member_id, status, created_at) VALUES ('second', ?, ?, NULL, 'active', 1)").run(doctor.memberId, other.orgId);
    db.exec("INSERT INTO organization_membership_roles VALUES ('second', 'admin')");
    const second: PolicySubject = { kind: 'membership', accountId: doctor.memberId, membershipId: 'second', orgId: other.orgId };
    expect(() => policy.require(second, 'staff.manage', organization(other.orgId))).not.toThrow();
    expect(() => policy.require(second, 'plan.issue', organization(other.orgId))).toThrow('forbidden');
    expect(() => policy.require(subject, 'plan.issue', organization(other.orgId))).toThrow('not_found');
    for (const changed of [{ accountId: 'other' }, { membershipId: 'second' }, { orgId: other.orgId }]) {
      expect(() => policy.require({ ...subject, ...changed }, 'plan.issue', organization(org.orgId))).toThrow('unauthenticated');
    }
  });
  for (const disabled of ['account', 'membership', 'legacy'] as const) it(`rejects cached legacy service Actors after ${disabled} deactivation`, () => {
    const { db, dir, doctor, staff, delivery, input } = rig();
    const issued = delivery.issue(doctor, input);
    if (disabled === 'account') db.prepare("UPDATE accounts SET status = 'disabled' WHERE id = ?").run(doctor.memberId);
    if (disabled === 'membership') db.prepare("UPDATE organization_memberships SET status = 'inactive' WHERE id = ?").run(doctor.memberId);
    if (disabled === 'legacy') db.prepare('UPDATE clinic_members SET active = 0 WHERE id = ?').run(doctor.memberId);
    expect(dir.authenticate(staff.token)).toBeNull();
    for (const call of [() => dir.profile(doctor), () => delivery.issue(doctor, input),
      () => delivery.status(doctor, issued.deliveryId), () => delivery.revoke(doctor, issued.deliveryId)]) {
      expect(call).toThrow('unauthenticated');
    }
    expect(db.prepare('SELECT status FROM plan_delivery WHERE id = ?').get(issued.deliveryId)?.status).toBe('pending');
  });
  it('membership deactivation and account disable take effect on the next policy call', () => {
    const { db, policy, subject, doctor, org } = rig();
    db.prepare("UPDATE accounts SET status = 'active' WHERE id = ?").run(doctor.memberId);
    policy.require(subject, 'plan.issue', organization(org.orgId));
    db.prepare("UPDATE organization_memberships SET status = 'inactive' WHERE id = ?").run(doctor.memberId);
    expect(() => policy.require(subject, 'plan.issue', organization(org.orgId))).toThrow('unauthenticated');
    db.prepare("UPDATE organization_memberships SET status = 'active' WHERE id = ?").run(doctor.memberId);
    db.prepare("UPDATE accounts SET status = 'disabled' WHERE id = ?").run(doctor.memberId);
    expect(() => policy.require(subject, 'plan.issue', organization(org.orgId))).toThrow('unauthenticated');
  });
  it('keeps existing delivery author IDs when membership IDs differ after linking', () => {
    const { db, policy, subject, doctor, org } = rig();
    db.prepare("UPDATE accounts SET status = 'active' WHERE id = ?").run(doctor.memberId);
    // FK update is represented as a new membership with the existing legacy link.
    db.prepare('DELETE FROM organization_membership_roles WHERE membership_id = ?').run(doctor.memberId);
    db.prepare("UPDATE organization_memberships SET id = 'linked-membership' WHERE id = ?").run(doctor.memberId);
    db.exec("INSERT INTO organization_membership_roles VALUES ('linked-membership', 'doctor')");
    policy.require({ ...subject, membershipId: 'linked-membership' }, 'delivery.status.read_own',
      { kind: 'delivery', orgId: org.orgId, authorMemberId: doctor.memberId });
  });
  it('services deny foreign delivery ids and leave payload/audit unchanged, without relying on HTTP middleware', () => {
    const { db, delivery, doctor, colleague, input, other, dir } = rig();
    const issued = delivery.issue(doctor, input);
    const otherDoc = dir.authenticate(dir.addStaff(dir.authenticate(other.token)!, { displayName: 'B', role: 'doctor' }).token)!;
    const snapshot = () => [db.prepare('SELECT * FROM plan_delivery').all(), db.prepare('SELECT * FROM clinic_audit').all()];
    const before = snapshot();
    for (const actor of [colleague, otherDoc, { ...doctor, orgId: other.orgId }] as Actor[]) {
      for (const call of [() => delivery.status(actor, issued.deliveryId), () => delivery.revoke(actor, issued.deliveryId)]) {
        expect(call).toThrow(actor.memberId === doctor.memberId ? 'unauthenticated' : 'not_found');
      }
    }
    expect(snapshot()).toEqual(before);
    expect(delivery.status(doctor, issued.deliveryId)).toBe('pending');
  });
});
