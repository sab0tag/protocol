import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate.ts';
import { ClinicDirectory } from './directory.ts';
import { PlanDelivery, MAX_TTL_MS, type RedeemStep } from './delivery.ts';

const rig = () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
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
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
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
  it('only the author sees or revokes a delivery; a colleague of the same clinic gets not_found and changes nothing', () => {
    const { del, dir, adminA, docA, a, plan, db } = rig();
    const colleague = dir.authenticate(dir.addStaff(adminA, { displayName: 'Колега', role: 'doctor' }).token)!;
    const d = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    const before = db.prepare('SELECT * FROM plan_delivery').get();
    expect(err(() => del.status(colleague, d.deliveryId))).toBe('not_found');
    expect(err(() => del.revoke(colleague, d.deliveryId))).toBe('not_found');
    expect(db.prepare('SELECT * FROM plan_delivery').get()).toEqual(before);
    expect(err(() => del.status(adminA, d.deliveryId))).toBe('forbidden');
    expect(del.status(docA, d.deliveryId)).toBe('pending');
    del.revoke(docA, d.deliveryId);
    expect(del.status(docA, d.deliveryId)).toBe('revoked');
  });
  it('a deactivated author can no longer read or revoke the status', () => {
    const { del, dir, adminA, docA, a, plan } = rig();
    const d = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    dir.deactivate(adminA, docA.memberId);
    expect(err(() => del.status(docA, d.deliveryId))).toBe('unauthenticated');
    expect(err(() => del.revoke(docA, d.deliveryId))).toBe('unauthenticated');
  });
  it('a deactivated doctor can no longer issue, but already issued links stay valid until revoked', () => {
    const { del, dir, adminA, docA, a, plan } = rig();
    const d = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    dir.deactivate(adminA, docA.memberId);
    expect(err(() => del.issue(docA, { plan: plan(a.orgId), patientConsent: true }))).toBe('unauthenticated');
    expect(del.redeem(d.code).title).toBe('План');
  });
  it('a payload altered in storage ends tampered: committed, erased, audited once, and never reported as used', () => {
    const corrupt: Record<string, (db: DatabaseSync) => void> = {
      hash: (db) => db.prepare("UPDATE plan_delivery SET plan = replace(plan, 'План', 'Інший')").run(),
      missing: (db) => db.prepare('UPDATE plan_delivery SET plan = NULL').run(),
      json: (db) => { const v = '{not json'; db.prepare('UPDATE plan_delivery SET plan = ?, plan_hash = ?').run(v, sha(v)); },
      schema: (db) => { const v = JSON.stringify({ schemaVersion: 2 }); db.prepare('UPDATE plan_delivery SET plan = ?, plan_hash = ?').run(v, sha(v)); },
      org: (db) => {
        const row = db.prepare('SELECT plan FROM plan_delivery').get() as { plan: string };
        const snapshot = JSON.parse(row.plan);
        const v = JSON.stringify({ ...snapshot, plan: { ...snapshot.plan, organizationId: 'інша' } });
        db.prepare('UPDATE plan_delivery SET plan = ?, plan_hash = ?').run(v, sha(v));
      },
    };
    for (const [kind, damage] of Object.entries(corrupt)) {
      const { del, dir, adminA, docA, a, plan, db } = rig();
      const d = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
      damage(db);
      expect(err(() => del.redeem(d.code)), kind).toBe('tampered');
      expect(err(() => del.redeem(d.code)), kind).toBe('tampered');
      expect(db.prepare('SELECT status, plan FROM plan_delivery').get(), kind).toEqual({ status: 'tampered', plan: null });
      expect(del.status(docA, d.deliveryId)).toBe('tampered');
      expect(err(() => del.revoke(docA, d.deliveryId))).toBe('not_found');
      expect(del.status(docA, d.deliveryId)).toBe('tampered');
      const events = dir.auditLog(adminA).filter((e) => e.action.startsWith('plan.tampered'));
      expect(events, kind).toEqual([expect.objectContaining({ actor: 'patient_link', action: `plan.tampered.${kind}`, target: d.deliveryId })]);
      expect(JSON.stringify(dir.auditLog(adminA))).not.toContain(d.code);
    }
  });
  it('a redemption is audited as patient_link with the delivery id, never the code', () => {
    const { del, dir, adminA, docA, a, plan } = rig();
    const d = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    del.redeem(d.code);
    const log = dir.auditLog(adminA);
    expect(log).toContainEqual(expect.objectContaining({ actor: 'patient_link', action: 'plan.redeem', target: d.deliveryId }));
    expect(JSON.stringify(log)).not.toContain(d.code);
  });
  it('keeps plan content out of the audit log', () => {
    const { del, dir, adminA, docA, a, plan } = rig();
    del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    const log = JSON.stringify(dir.auditLog(adminA));
    expect(log).toContain('plan.issue');
    expect(log).not.toMatch(/План|Лікар/);
  });
});

describe('stats', () => {
  it('counts redeemed, expired, revoked and pending in the window and respects the roles', () => {
    const { del, adminA, docA, a, plan, tick } = rig();
    const r = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    del.redeem(r.code);
    del.issue(docA, { plan: plan(a.orgId), patientConsent: true, ttlMs: 1000 });
    const v = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    del.revoke(docA, v.deliveryId);
    del.issue(docA, { plan: plan(a.orgId), patientConsent: true, ttlMs: 60_000 });
    tick(2000);
    expect(del.stats(adminA)).toMatchObject({ issued: 4, redeemed: 1, expired: 1, revoked: 1, pending: 1, tampered: 0 });
    tick(40 * 24 * 3600 * 1000);
    expect(del.stats(adminA, 30).issued).toBe(0);
    expect(err(() => del.stats(docA))).toBe('forbidden');
  });
});

describe('stats with tampered deliveries', () => {
  it('counts tampered separately, not as redeemed, and the states still add up to the issued total', () => {
    const { del, adminA, docA, a, plan, db } = rig();
    const ok = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    del.redeem(ok.code);
    const bad = del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    db.prepare("UPDATE plan_delivery SET plan = replace(plan, 'План', 'Інший') WHERE id = ?").run(bad.deliveryId);
    expect(err(() => del.redeem(bad.code))).toBe('tampered');
    del.issue(docA, { plan: plan(a.orgId), patientConsent: true });
    const s = del.stats(adminA);
    expect(s).toMatchObject({ issued: 3, redeemed: 1, tampered: 1, pending: 1, expired: 0, revoked: 0 });
    expect(s.redeemed + s.pending + s.expired + s.revoked + s.tampered).toBe(s.issued);
  });
});

describe('redeem atomicity under technical faults', () => {
  const faulty = (failAt: RedeemStep, damage = false) => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const dir = new ClinicDirectory(db);
    let armed = true;
    const del = new PlanDelivery(db, dir, Date.now, (step) => { if (armed && step === failAt) { armed = false; throw new Error(`fault at ${step}`); } });
    const org = dir.createOrganization('А', 'Адмін');
    const admin = dir.authenticate(org.token)!;
    const doc = dir.authenticate(dir.addStaff(admin, { displayName: 'Лікар', role: 'doctor' }).token)!;
    const d = del.issue(doc, { plan: { schemaVersion: 1, planId: crypto.randomUUID(), organizationId: org.orgId, issuedAt: '2025-01-01T10:00:00+02:00',
      clinician: { displayName: 'Лікар', organizationName: 'А' }, title: 'План', medications: [], restrictions: [], tests: [] }, patientConsent: true });
    if (damage) db.prepare("UPDATE plan_delivery SET plan = replace(plan, 'План', 'Інший')").run();
    const snapshot = () => ({ row: db.prepare('SELECT status, plan FROM plan_delivery').get(), audit: dir.auditLog(admin).length });
    return { del, d, db, snapshot };
  };

  for (const step of ['read', 'transition', 'audit'] as const) {
    it(`a fault at "${step}" rolls back status, payload and audit; the next attempt succeeds`, () => {
      const { del, d, snapshot, db } = faulty(step);
      const before = snapshot();
      expect(() => del.redeem(d.code)).toThrow(`fault at ${step}`);
      expect(db.isTransaction).toBe(false);
      expect(snapshot()).toEqual(before);
      expect(del.redeem(d.code).title).toBe('План');
      expect(err(() => del.redeem(d.code))).toBe('used');
    });
    it(`a fault at "${step}" while marking a damaged payload leaves it pending, then the retry commits tampered`, () => {
      const { del, d, snapshot, db } = faulty(step, true);
      const before = snapshot();
      expect(() => del.redeem(d.code)).toThrow(`fault at ${step}`);
      expect(snapshot()).toEqual(before);
      expect((before.row as { status: string }).status).toBe('pending');
      expect(err(() => del.redeem(d.code))).toBe('tampered');
      expect(db.prepare('SELECT status, plan FROM plan_delivery').get()).toEqual({ status: 'tampered', plan: null });
    });
  }
});
