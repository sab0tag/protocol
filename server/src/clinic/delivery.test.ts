import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ClinicDirectory } from './directory.ts';
import { PlanDelivery, MAX_TTL_MS } from './delivery.ts';

const rig = () => {
  const db = new DatabaseSync(':memory:');
  let t = 1_000_000;
  const now = () => t;
  const dir = new ClinicDirectory(db, now);
  const del = new PlanDelivery(db, dir, now);
  const a = dir.createOrganization('А', 'Адмін А'), b = dir.createOrganization('Б', 'Адмін Б');
  const adminA = dir.authenticate(a.token)!;
  const docA = dir.authenticate(dir.addStaff(adminA, { displayName: 'Лікар А', role: 'doctor' }).token)!;
  const adminB = dir.authenticate(b.token)!;
  const docB = dir.authenticate(dir.addStaff(adminB, { displayName: 'Лікар Б', role: 'doctor' }).token)!;
  const plan = (orgId: string) => ({
    schemaVersion: 1, planId: crypto.randomUUID(), organizationId: orgId, issuedAt: '2025-01-01T10:00:00+02:00',
    clinician: { displayName: 'Лікар', organizationName: 'А' }, title: 'План',
    medications: [{ name: 'Х', dose: '1', frequency: 'раз', duration: '', instructions: '' }], restrictions: [], tests: [],
  });
  return { db, dir, del, a, b, docA, docB, adminA, plan, tick: (ms: number) => { t += ms; } };
};
const err = (f: () => unknown) => { try { f(); } catch (e) { return (e as { code: string }).code; } return 'ok'; };

describe('plan delivery', () => {
  it('hands the plan over exactly once and erases it', () => {
    const { del, docA, a, plan, db } = rig();
    const { code } = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    expect(del.redeem(code).title).toBe('План');
    expect(err(() => del.redeem(code))).toBe('used');
    expect((db.prepare('SELECT plan FROM plan_delivery').get() as { plan: string | null }).plan).toBeNull();
  });
  it('the code is random, does not contain the plan, and the server stores only its hash', () => {
    const { del, docA, a, plan, db } = rig();
    const { code } = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    expect(code).not.toMatch(/План|Х/);
    expect(JSON.stringify(db.prepare('SELECT * FROM plan_delivery').all())).not.toContain(code);
  });
  it('rejects an expired link', () => {
    const { del, docA, a, plan, tick } = rig();
    const { code } = del.issue(docA, { plan: plan(a.orgId), patientConsent: true, ttlMs: 1000 });
    tick(1000);
    expect(err(() => del.redeem(code))).toBe('expired');
  });
  it('rejects unknown and malformed codes', () => {
    const { del } = rig();
    expect(err(() => del.redeem('x'.repeat(43)))).toBe('invalid');
    expect(err(() => del.redeem(''))).toBe('invalid');
  });
  it('requires consent, a valid plan, the own organization and a bounded lifetime', () => {
    const { del, docA, a, b, plan } = rig();
    expect(err(() => del.issue(docA, { plan: plan(a.orgId), patientConsent: false }))).toBe('bad_request');
    expect(err(() => del.issue(docA, { plan: plan(b.orgId), patientConsent: true }))).toBe('bad_request');
    expect(err(() => del.issue(docA, { plan: { x: 1 }, patientConsent: true }))).toBe('bad_request');
    expect(err(() => del.issue(docA, { plan: plan(a.orgId), patientConsent: true, ttlMs: MAX_TTL_MS + 1 }))).toBe('bad_request');
  });
  it('only doctors issue; admins cannot', () => {
    const { del, adminA, a, plan } = rig();
    expect(err(() => del.issue(adminA, { plan: plan(a.orgId), patientConsent: true }))).toBe('forbidden');
  });
  it('a revoked delivery cannot be redeemed; another organization cannot revoke or see it', () => {
    const { del, docA, docB, a, plan } = rig();
    const d = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    expect(err(() => del.revoke(docB, d.deliveryId))).toBe('not_found');
    expect(err(() => del.status(docB, d.deliveryId))).toBe('not_found');
    del.revoke(docA, d.deliveryId);
    expect(del.status(docA, d.deliveryId)).toBe('revoked');
    expect(err(() => del.redeem(d.code))).toBe('revoked');
  });
  it('a deactivated doctor can no longer issue, but already issued links stay valid until revoked', () => {
    const { del, dir, adminA, docA, a, plan } = rig();
    const d = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    dir.deactivate(adminA, docA.memberId);
    expect(err(() => del.issue(docA, { plan: plan(a.orgId), patientConsent: true }))).toBe('unauthenticated');
    expect(del.redeem(d.code).title).toBe('План');
  });
  it('detects a plan altered in storage', () => {
    const { del, docA, a, plan, db } = rig();
    const { code } = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    db.prepare("UPDATE plan_delivery SET plan = replace(plan, 'План', 'Інший')").run();
    expect(err(() => del.redeem(code))).toBe('tampered');
    expect(err(() => del.redeem(code))).toBe('used');
  });
  it('keeps plan content out of the audit log', () => {
    const { del, dir, adminA, docA, a, plan } = rig();
    del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    const log = JSON.stringify(dir.auditLog(adminA));
    expect(log).toContain('plan.issue');
    expect(log).not.toMatch(/План|Лікар/);
  });
});
