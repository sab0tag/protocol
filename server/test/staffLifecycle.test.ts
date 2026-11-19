// D176 (queue task 6): the staff access lifecycle — 90 idle days suspend, an admin restores; the quarterly access list;
// old tokens retired (none issued, 30 days for those out); a waiting plan sealed with the patient's code (ACCESS-07-B).
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { ClinicDirectory } from '../src/clinic/directory.ts';
import { openPlan, PlanDelivery } from '../src/clinic/delivery.ts';
import { StaffInvitations } from '../src/clinic/invitations.ts';
import { IDLE_MS, retireTokens, suspendIdle, TOKEN_LIFE_MS } from '../src/clinic/lifecycle.ts';
import type { InvitationMessage } from '../src/clinic/invitationMail.ts';
import { Sessions } from '../src/identity/sessions.ts';
import { Store } from '../src/store.ts';

const DAY = 86_400_000;
const stores: Store[] = []; afterEach(() => { for (const s of stores.splice(0)) s.close(); });

function rig(opts: { tokensRetired?: boolean } = {}) {
  const store = Store.migrated(':memory:'); stores.push(store); const db = store.database; let now = Date.parse('2026-11-19T09:00:00Z');
  const legacyDir = new ClinicDirectory(db, () => now); // the operator's org and a provisional doctor, made before the switch
  const org = legacyDir.createOrganization('Synthetic Clinic', 'Admin'), oldAdmin = legacyDir.authenticate(org.token)!;
  const doctor = legacyDir.addStaff(oldAdmin, { displayName: 'Doctor', role: 'doctor' });
  const dir = new ClinicDirectory(db, () => now, opts), sessions = new Sessions(db, () => now);
  const login = (subject: string, email: string) => {
    const r = sessions.signIn({ issuer: 'https://issuer.test/', subject, authTime: now, mfa: true, verifiedEmail: email, replacing: null });
    if (typeof r === 'string') throw Error(r); return r;
  };
  db.prepare("UPDATE accounts SET status = 'active' WHERE id = ?").run(org.adminId);
  db.prepare('INSERT INTO external_identities VALUES (?, ?, ?, ?)').run('https://issuer.test/', 'admin', org.adminId, now);
  const admin = () => dir.authenticateSession(login('admin', 'admin@example.invalid').session.hash, org.orgId);
  const mail: InvitationMessage[] = [];
  const invites = new StaffInvitations(db, dir, 'https://app.test', async (m) => { mail.push(m); }, () => now);
  /** the provisional doctor accepts an invitation and signs in — an identified membership with its 90-day clock */
  const joinDoctor = async () => {
    await invites.invite(admin(), { email: 'doctor@example.invalid', displayName: 'Doctor', roles: ['doctor'], targetMemberId: doctor.memberId });
    const secret = new URL(mail.at(-1)!.link).hash.split('code=')[1]!, s = login('doctor', 'doctor@example.invalid');
    invites.accept(s.session.hash, secret);
  };
  const doctorSession = () => dir.authenticateSession(login('doctor', 'doctor@example.invalid').session.hash, org.orgId);
  const audit = () => (db.prepare('SELECT actor, action, target FROM clinic_audit WHERE org = ? ORDER BY id').all(org.orgId) as { actor: string; action: string; target: string }[]);
  return { db, store, dir, legacyDir, org, oldAdmin, doctor, admin, joinDoctor, doctorSession, audit, tick: (ms: number) => { now += ms; }, now: () => now };
}

describe('90 days without a sign-in', () => {
  it('a sign-in within 90 days restarts the clock; after 90 it does not — suspended, said, written down once', async () => {
    const r = rig(); await r.joinDoctor();
    r.tick(89 * DAY); r.admin(); expect(() => r.doctorSession()).not.toThrow(); // day 89: fine, and the clock restarts
    r.tick(89 * DAY); r.admin(); expect(() => r.doctorSession()).not.toThrow();
    r.tick(60 * DAY); r.admin(); r.tick(30 * DAY); r.admin(); // the admin keeps signing in, the doctor does not
    expect(() => r.doctorSession()).toThrow('suspended'); // a late sign-in does not reset the clock
    expect(() => r.doctorSession()).toThrow('suspended');
    expect(r.audit().filter((a) => a.action === 'staff.suspend.idle')).toEqual([{ actor: 'system', action: 'staff.suspend.idle', target: r.doctor.memberId }]);
    expect(r.dir.listStaff(r.admin()).find((m) => m.id === r.doctor.memberId)).toMatchObject({ suspended: true, linked: true });
  });

  it('the check does not wait for the hourly sweep; the sweep writes it down for everyone idle', async () => {
    const r = rig(); await r.joinDoctor();
    const s = r.doctorSession(); r.tick(IDLE_MS + 1);
    expect(r.db.prepare('SELECT suspended_at FROM organization_memberships WHERE legacy_member_id = ?').get(r.doctor.memberId)?.suspended_at).toBeNull();
    expect(suspendIdle(r.db, r.now())).toBe(2); // the doctor and the admin — both idle
    expect(suspendIdle(r.db, r.now())).toBe(0); // once
    void s;
  });

  it('a provisional record waiting for its invitation is never «idle» (it has no sign-in to miss)', () => {
    const r = rig(); r.tick(400 * DAY);
    suspendIdle(r.db, r.now());
    expect(r.db.prepare('SELECT suspended_at FROM organization_memberships WHERE legacy_member_id = ?').get(r.doctor.memberId)?.suspended_at).toBeNull();
  });

  it('only an admin restores: with a fresh sign-in; the clock starts again; written down', async () => {
    const r = rig(); await r.joinDoctor();
    r.tick(60 * DAY); r.admin(); r.tick(31 * DAY);
    const admin = r.admin();
    expect(() => r.doctorSession()).toThrow('suspended');
    expect(() => r.dir.restore(r.dir.authenticate(r.org.token)!, r.doctor.memberId)).toThrow('forbidden'); // an old token cannot
    r.dir.restore(admin, r.doctor.memberId);
    expect(() => r.doctorSession()).not.toThrow();
    expect(r.audit().filter((a) => a.action === 'staff.restore')).toHaveLength(1);
    r.tick(11 * 60_000); // past the fresh window of that admin sign-in
    expect(() => r.dir.restore(admin, r.doctor.memberId)).toThrow();
  });
});

describe('the quarterly «who has access» list', () => {
  it('due until confirmed; confirmed — the count and ids only; due again after a quarter', async () => {
    const r = rig(); await r.joinDoctor();
    const before = r.dir.accessReview(r.admin());
    expect(before).toMatchObject({ due: true, lastReview: null });
    expect(before.members.map((m) => m.displayName).sort()).toEqual(['Admin', 'Doctor']);
    const done = r.dir.confirmAccess(r.admin());
    expect(done.members).toBe(2);
    expect(r.dir.accessReview(r.admin())).toMatchObject({ due: false, lastReview: { at: r.now(), members: 2 } });
    expect(JSON.stringify(r.db.prepare('SELECT * FROM clinic_access_reviews').all())).not.toMatch(/Doctor|Admin|@/);
    r.tick(89 * DAY); expect(r.dir.accessReview(r.admin()).due).toBe(false);
    r.tick(2 * DAY); expect(r.dir.accessReview(r.admin()).due).toBe(true);
    expect(() => r.dir.confirmAccess(r.dir.authenticate(r.org.token)!)).toThrow('forbidden'); // an old token cannot confirm
  });
});

describe('old tokens retired', () => {
  it('with sign-in by invitation on: none issued, none rotated; the operator’s first one lives 30 days', () => {
    const r = rig({ tokensRetired: true });
    expect(() => r.dir.addStaff(r.dir.authenticate(r.org.token)!, { displayName: 'New', role: 'doctor' })).toThrow('tokens_retired');
    expect(() => r.dir.rotateToken(r.dir.authenticate(r.org.token)!, r.doctor.memberId)).toThrow('tokens_retired');
    const fresh = r.dir.createOrganization('Second Clinic', 'Second Admin');
    expect(r.dir.profile(r.dir.authenticate(fresh.token)!).tokenUntil).toBe(r.now() + TOKEN_LIFE_MS);
    r.tick(TOKEN_LIFE_MS);
    expect(r.dir.authenticate(fresh.token)).toBeNull();
  });

  it('the switch gives every token out a deadline 30 days ahead, once; the cabinet shows it; then the token stops', () => {
    const r = rig({ tokensRetired: true });
    expect(retireTokens(r.db, r.now())).toBe(2); // the admin's and the doctor's
    expect(retireTokens(r.db, r.now() + DAY)).toBe(0); // never pushed further
    expect(r.dir.profile(r.dir.authenticate(r.doctor.token)!).tokenUntil).toBe(r.now() + TOKEN_LIFE_MS);
    r.tick(TOKEN_LIFE_MS - 1); expect(r.dir.authenticate(r.doctor.token)).not.toBeNull();
    r.tick(1); expect(r.dir.authenticate(r.doctor.token)).toBeNull();
  });

  it('without the switch nothing changes: tokens work, no deadline shown', () => {
    const r = rig();
    r.tick(400 * DAY);
    const a = r.dir.authenticate(r.doctor.token)!;
    expect(a).not.toBeNull();
    expect(r.dir.profile(a).tokenUntil).toBeUndefined();
  });

  it('HTTP: adding staff by token answers 410 tokens_retired', async () => {
    const r = rig({ tokensRetired: true });
    const app = createApp({ store: r.store, origins: [], clinic: r.dir, planDelivery: new PlanDelivery(r.db, r.dir, r.now) });
    const res = await app.request('/v1/clinic/staff', { method: 'POST', headers: { Authorization: `Bearer ${r.org.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'New', role: 'doctor' }) });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'tokens_retired' });
  });
});

describe('a waiting plan is sealed (ACCESS-07-B)', () => {
  it('the stored bytes hold no plan; only the patient’s code opens them; the plan comes out whole', () => {
    const r = rig();
    const doc = r.dir.authenticate(r.doctor.token)!, delivery = new PlanDelivery(r.db, r.dir, r.now);
    const d = delivery.issue(doc, { patientConsent: true, plan: { schemaVersion: 1, planId: crypto.randomUUID(), organizationId: r.org.orgId,
      issuedAt: '2026-11-19T09:00:00Z', clinician: { displayName: 'Doctor', organizationName: 'Synthetic Clinic' }, title: 'Secret title',
      medications: [{ name: 'Metformin', dose: '500 mg', frequency: 'twice', duration: '', instructions: '' }], restrictions: [], tests: [] } });
    const row = r.db.prepare('SELECT plan, sealed FROM plan_delivery WHERE id = ?').get(d.deliveryId) as { plan: string; sealed: number };
    expect(row.sealed).toBe(1);
    expect(JSON.stringify(r.db.prepare('SELECT * FROM plan_delivery').all())).not.toMatch(/Secret title|Metformin|500 mg/);
    expect(openPlan('x'.repeat(43), d.deliveryId, row.plan)).toBeNull(); // a copy of the database without the code
    expect(openPlan(d.code, 'another-id', row.plan)).toBeNull(); // bound to its delivery
    expect(delivery.redeem(d.code)).toMatchObject({ title: 'Secret title', medications: [{ name: 'Metformin' }] });
    expect(r.db.prepare('SELECT plan FROM plan_delivery WHERE id = ?').get(d.deliveryId)?.plan).toBeNull();
  });
});
