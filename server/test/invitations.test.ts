import { createHash } from 'node:crypto';
import { mutationHousekeeping, type Mutation } from '../src/db/mutations.ts';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { StaffInvitations, INVITATION_MS } from '../src/clinic/invitations.ts';
import { ClinicDirectory } from '../src/clinic/directory.ts';
import { PlanDelivery } from '../src/clinic/delivery.ts';
import { Sessions } from '../src/identity/sessions.ts';
import { Store } from '../src/store.ts';
import { assertCurrent, migrate, MIGRATIONS } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';
import { Oidc } from '../src/identity/oidc.ts';
import type { InvitationMessage } from '../src/clinic/invitationMail.ts';
const stores: Store[] = []; afterEach(() => { for (const s of stores.splice(0)) s.close(); });
function rig(path = ':memory:') {
  const store = Store.migrated(path); stores.push(store); const db = store.database; let now = Date.now();
  const dir = new ClinicDirectory(db, () => now), sessions = new Sessions(db, () => now);
  const org = dir.createOrganization('Synthetic Clinic', 'Admin'), oldAdmin = dir.authenticate(org.token)!;
  const doctor = dir.addStaff(oldAdmin, { displayName: 'Doctor', role: 'doctor' });
  const other = dir.createOrganization('Other Clinic', 'Other Admin');
  const login = (subject: string, email: string | null = 'doctor@example.invalid', mfa = true) => {
    const result = sessions.signIn({ issuer: 'https://issuer.test/', subject, authTime: now, mfa, verifiedEmail: email, replacing: null });
    if (typeof result === 'string') throw Error(result); return result;
  };
  // Explicit fixture setup for the inviter only. Recipient tests use the actual invitation acceptance path.
  db.prepare("UPDATE accounts SET status = 'active' WHERE id = ?").run(org.adminId);
  db.prepare('INSERT INTO external_identities VALUES (?, ?, ?, ?)').run('https://issuer.test/', 'admin', org.adminId, now);
  const adminLogin = login('admin', 'admin@example.invalid'), admin = dir.authenticateSession(adminLogin.session.hash, org.orgId);
  const mail: InvitationMessage[] = [];
  const invites = new StaffInvitations(db, dir, 'https://app.test', async m => { mail.push(m); }, () => now);
  const input = { email: 'doctor@example.invalid', displayName: 'Doctor', roles: ['doctor'] as ('doctor' | 'admin')[], targetMemberId: doctor.memberId };
  const code = () => new URL(mail.at(-1)!.link).hash.split('code=')[1]!;
  return { store, db, dir, sessions, org, other, doctor, admin, adminLogin, login, mail, invites, input, code, tick: (ms: number) => { now += ms; }, now: () => now };
}

describe('72-hour invitations and explicit legacy linking', () => {
  it('sends only a hashed secret, previews the intended context, preserves author IDs and accepts once', async () => {
    const r = rig(), actor = r.dir.authenticate(r.doctor.token)!;
    const delivery = new PlanDelivery(r.db, r.dir, r.now).issue(actor, { patientConsent: true, plan: { schemaVersion: 1, planId: crypto.randomUUID(), organizationId: r.org.orgId,
      issuedAt: '2026-10-29T12:00:00Z', clinician: { displayName: 'Doctor', organizationName: 'Synthetic Clinic' }, title: 'Synthetic', medications: [], restrictions: [], tests: [] } });
    const before = r.db.prepare('SELECT * FROM plan_delivery').all();
    const created = await r.invites.invite(r.admin, r.input), secret = r.code(), recipient = r.login('doctor');
    expect(created.expiresAt).toBe(r.now() + INVITATION_MS);
    expect(JSON.stringify(r.db.prepare('SELECT * FROM staff_invitations').all())).not.toContain(secret);
    expect(JSON.stringify(created)).not.toContain(secret); expect(JSON.stringify(r.db.prepare('SELECT * FROM clinic_audit').all())).not.toContain(secret);
    expect(r.sessions.contexts(recipient.session.accountId)).toHaveLength(0);
    expect(r.invites.preview(recipient.session.hash, secret)).toMatchObject({ clinic: 'Synthetic Clinic', roles: ['doctor'] });
    expect(r.invites.accept(recipient.session.hash, secret)).toEqual({ organizationId: r.org.orgId, membershipId: r.doctor.memberId });
    expect(() => r.invites.accept(recipient.session.hash, secret)).toThrow('not_found');
    expect(r.db.prepare('SELECT * FROM plan_delivery').all()).toEqual(before);
    const doctor = r.dir.authenticateSession(recipient.session.hash, r.org.orgId);
    expect(new PlanDelivery(r.db, r.dir, r.now).status(doctor, delivery.deliveryId)).toBe('pending');
    expect(r.db.prepare('SELECT status FROM accounts WHERE id = ?').get(r.doctor.memberId)?.status).toBe('disabled');
    expect(r.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  for (const email of [null, 'other@example.invalid', 'Doctor@example.invalid']) it(`does not link an unverified or different recipient (${email})`, async () => {
    const r = rig(); await r.invites.invite(r.admin, r.input); const s = r.login('recipient', email);
    expect(() => r.invites.preview(s.session.hash, r.code())).toThrow('recipient_mismatch');
    expect(() => r.invites.accept(s.session.hash, r.code())).toThrow('recipient_mismatch');
    expect(r.sessions.contexts(s.session.accountId)).toEqual([]); expect(r.invites.list(r.admin)[0]?.state).toBe('sent');
  });
  it('MFA, fresh authentication and a live account are rechecked at acceptance', async () => {
    const r = rig(); await r.invites.invite(r.admin, r.input); const noMfa = r.login('no-mfa', r.input.email, false);
    expect(() => r.invites.accept(noMfa.session.hash, r.code())).toThrow('mfa_required');
    const s = r.login('recipient'); r.tick(600_001);
    expect(() => r.invites.accept(s.session.hash, r.code())).toThrow('step_up_required');
    r.db.prepare("UPDATE accounts SET status = 'disabled' WHERE id = ?").run(s.session.accountId);
    expect(() => r.invites.accept(s.session.hash, r.code())).toThrow('unauthorized');
  });
  for (const change of ['revoke', 'expire', 'resend', 'inviterDisabled', 'inviterRole', 'targetDisabled', 'targetRole']) it(`denies ${change} without changing the recipient`, async () => {
    const r = rig(), s = r.login('recipient'); const i = await r.invites.invite(r.admin, r.input), secret = r.code();
    if (change === 'revoke') r.invites.revoke(r.admin, i.id);
    if (change === 'expire') { r.tick(INVITATION_MS); const fresh = r.login('recipient'); s.session = fresh.session; }
    if (change === 'resend') await r.invites.invite(r.admin, r.input);
    if (change === 'inviterDisabled') r.db.prepare("UPDATE accounts SET status = 'disabled' WHERE id = ?").run(r.org.adminId);
    if (change === 'inviterRole') r.db.prepare('DELETE FROM organization_membership_roles WHERE membership_id = ?').run(r.org.adminId);
    if (change === 'targetDisabled') r.dir.deactivate(r.admin, r.doctor.memberId);
    if (change === 'targetRole') r.dir.setRole(r.admin, r.doctor.memberId, 'admin');
    expect(() => r.invites.accept(s.session.hash, secret)).toThrow();
    expect(r.sessions.contexts(s.session.accountId)).toEqual([]);
  });
  it('rolls back the complete acceptance if the audit insert fails', async () => {
    const r = rig(); await r.invites.invite(r.admin, r.input); const s = r.login('recipient');
    const before = ['accounts', 'organization_memberships', 'organization_membership_roles', 'staff_invitations'].map(t => r.db.prepare(`SELECT * FROM ${t}`).all());
    r.db.exec("CREATE TEMP TRIGGER reject_accept BEFORE INSERT ON clinic_audit WHEN NEW.action = 'staff.invite.accept' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END");
    expect(() => r.invites.accept(s.session.hash, r.code())).toThrow('synthetic audit failure');
    expect(['accounts', 'organization_memberships', 'organization_membership_roles', 'staff_invitations'].map(t => r.db.prepare(`SELECT * FROM ${t}`).all())).toEqual(before);
    r.db.exec('DROP TRIGGER reject_accept'); expect(r.invites.accept(s.session.hash, r.code()).membershipId).toBe(r.doctor.memberId);
  });
  it('mail failure leaves an unusable invitation; resend rotates the code', async () => {
    const r = rig(), failed = new StaffInvitations(r.db, r.dir, 'https://app.test', async m => { r.mail.push(m); throw Error('SMTP response with sensitive content'); }, r.now);
    await expect(failed.invite(r.admin, r.input)).rejects.toThrow('unavailable'); const code = r.code(), s = r.login('recipient');
    expect(r.invites.list(r.admin)[0]?.state).toBe('failed'); expect(() => r.invites.accept(s.session.hash, code)).toThrow('not_found');
    await r.invites.invite(r.admin, r.input); expect(r.code()).not.toBe(code); expect(r.invites.accept(s.session.hash, r.code())).toBeDefined();
  });
  it('a revoke during SMTP submission cannot reactivate the invitation', async () => {
    const r = rig(), service = new StaffInvitations(r.db, r.dir, 'https://app.test', async m => {
      r.mail.push(m); const id = r.invites.list(r.admin)[0]!.id; r.invites.revoke(r.admin, String(id));
    }, r.now);
    await expect(service.invite(r.admin, r.input)).rejects.toThrow('conflict');
    expect(r.invites.list(r.admin)[0]?.state).toBe('revoked');
  });
  it('only a fresh session admin may invite; an old bearer alone cannot bind an identity', async () => {
    const r = rig(); await expect(r.invites.invite(r.dir.authenticate(r.org.token)!, r.input)).rejects.toThrow('unavailable');
    const s = r.login('recipient'); await r.invites.invite(r.admin, r.input); r.invites.accept(s.session.hash, r.code());
    const { targetMemberId: _target, ...newStaff } = r.input;
    await expect(r.invites.invite(r.dir.authenticateSession(s.session.hash, r.org.orgId), newStaff)).rejects.toThrow('forbidden');
  });
  it('creates a new staff author only after explicit acceptance, with no usable bearer returned', async () => {
    const r = rig(), { targetMemberId: _target, ...input } = r.input; input.roles = ['admin', 'doctor'];
    await r.invites.invite(r.admin, input); const s = r.login('recipient'), accepted = r.invites.accept(s.session.hash, r.code());
    expect(accepted.membershipId).not.toBe(r.doctor.memberId); expect(r.dir.profile(r.dir.authenticateSession(s.session.hash, r.org.orgId)).roles).toEqual(['admin', 'doctor']);
    expect(JSON.stringify(accepted)).not.toContain('token'); expect(r.db.prepare('SELECT count(*) AS n FROM accounts').get()?.n).toBe(4);
    await expect(r.invites.invite(r.admin, r.input)).resolves.toBeDefined(); expect(() => r.invites.accept(s.session.hash, r.code())).toThrow('conflict');
  });
  it('operator bootstrap validates the schema in the write transaction; ordinary invites cannot cross clinics', async () => {
    const r = rig();
    await expect(r.invites.invite(r.admin, { ...r.input, targetMemberId: r.other.adminId })).rejects.toThrow('not_found');
    await expect(r.invites.inviteOperator(r.other.orgId, { email: 'other@example.invalid', displayName: 'Other Admin', roles: ['admin'], targetMemberId: r.other.adminId }, () => { throw Error('schema refused'); })).rejects.toThrow('schema refused');
    expect(r.mail).toHaveLength(0);
    await r.invites.inviteOperator(r.other.orgId, { email: 'other@example.invalid', displayName: 'Other Admin', roles: ['admin'], targetMemberId: r.other.adminId }, () => assertCurrent(r.db));
    const s = r.login('other', 'other@example.invalid'); expect(r.invites.accept(s.session.hash, r.code()).membershipId).toBe(r.other.adminId);
  });
});

describe('per-clinic legacy cutoff', () => {
  it('requires all active staff linked, caps grace at seven days, cannot extend/reset, survives disabled identity routes', async () => {
    const r = rig(); expect(() => r.dir.cutover(r.admin, 168)).toThrow('bad_request');
    await r.invites.invite(r.admin, r.input); const s = r.login('recipient'); r.invites.accept(s.session.hash, r.code());
    expect(() => r.dir.cutover(r.admin, 169)).toThrow('bad_request'); r.dir.cutover(r.admin, 168);
    expect(r.dir.authenticate(r.doctor.token)).not.toBeNull(); r.tick(60_000);
    expect(() => r.dir.cutover(r.admin, 168)).toThrow('bad_request');
    r.dir.cutover(r.admin, 0);
    expect(() => r.dir.addStaff(r.admin, { displayName: 'Denied legacy staff', role: 'doctor' })).toThrow('forbidden');
    expect(() => r.dir.rotateToken(r.admin, r.doctor.memberId)).toThrow('forbidden');
    expect(r.dir.authenticate(r.org.token)).toBeNull(); expect(r.dir.authenticate(r.doctor.token)).toBeNull();
    const app = createApp({ store: r.store, clinic: r.dir, planDelivery: new PlanDelivery(r.db, r.dir, r.now), origins: ['https://app.test'] });
    expect((await app.request('/v1/clinic/me', { headers: { Authorization: `Bearer ${r.org.token}` } })).status).toBe(401);
    expect(r.dir.authenticate(r.other.token)).not.toBeNull(); expect(r.dir.profile(r.dir.authenticateSession(s.session.hash, r.org.orgId))).toMatchObject({ role: 'doctor' });
  });
  it('removing a role revokes the old single-role token; adding a role never widens it; last admin is protected', async () => {
    const r = rig(); await r.invites.invite(r.admin, r.input); const s = r.login('recipient'); r.invites.accept(s.session.hash, r.code());
    r.dir.setRoles(r.admin, r.doctor.memberId, ['admin', 'doctor']);
    expect(() => r.dir.listStaff(r.dir.authenticate(r.doctor.token)!)).toThrow('forbidden');
    const cachedDoctor = r.dir.authenticate(r.doctor.token)!;
    r.dir.setRoles(r.admin, r.doctor.memberId, ['admin']); expect(r.dir.authenticate(r.doctor.token)).toBeNull();
    expect(() => r.dir.listStaff(cachedDoctor)).toThrow('unauthenticated');
    r.dir.cutover(r.admin, 0); r.dir.setRoles(r.admin, r.org.adminId, ['doctor']);
    const last = r.dir.authenticateSession(s.session.hash, r.org.orgId);
    expect(() => r.dir.setRoles(last, r.doctor.memberId, ['doctor'])).toThrow('last_admin');
    expect(() => r.dir.deactivate(last, r.doctor.memberId)).toThrow('last_admin');
  });
  it('upgrade from v4 preserves sessions and author records, requiring a new verified contact for acceptance', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('PRAGMA foreign_keys = ON'); migrate(db, MIGRATIONS().slice(0,4));
      db.exec("INSERT INTO accounts VALUES ('a','active',1); INSERT INTO sessions VALUES ('hash','a','https://issuer.test/',1,1,999999,NULL,1,1,'csrf')");
      const before = db.prepare('SELECT * FROM sessions').all();
      expect(migrate(db).applied).toEqual([5]);
      expect(db.prepare('SELECT * FROM sessions').all()).toEqual(before.map(row => ({ ...row, verified_email: null })));
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  });
});


describe('invitation HTTP boundary', () => {
  it('requires session + Origin + CSRF and ignores a forged contact from request JSON', async () => {
    const r = rig(), cfg = { issuer: new URL('https://issuer.test/'), clientId: 'synthetic', clientSecret: 'synthetic', redirectUri: new URL('https://api.test/v1/auth/callback'), appOrigin: 'https://app.test', mfaAmr: 'mfa' };
    const app = createApp({ store: r.store, clinic: r.dir, planDelivery: new PlanDelivery(r.db, r.dir, r.now), origins: [cfg.appOrigin],
      identity: { cfg, oidc: new Oidc(cfg), sessions: r.sessions }, invitations: r.invites, now: () => new Date(r.now()) });
    const req = (path: string, token: string, csrf: string | null, body: unknown, origin = cfg.appOrigin) => app.request(`https://api.test${path}`, { method: 'POST',
      headers: { Cookie: `__Host-psess=${token}`, Origin: origin, 'X-Clinic-Id': r.org.orgId, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: JSON.stringify(body) });
    expect((await req('/v1/clinic/invitations', r.adminLogin.token, null, r.input)).status).toBe(403);
    expect((await req('/v1/clinic/invitations', r.adminLogin.token, r.adminLogin.session.csrf, r.input, 'https://evil.test')).status).toBe(403);
    const created = await req('/v1/clinic/invitations', r.adminLogin.token, r.adminLogin.session.csrf, r.input);
    expect(created.status).toBe(201); expect(JSON.stringify(await created.json())).not.toContain(r.code());
    const wrong = r.login('wrong', 'other@example.invalid');
    expect((await req('/v1/session/invitations/accept', wrong.token, wrong.session.csrf, { code: r.code(), email: r.input.email, email_verified: true })).status).toBe(403);
    const right = r.login('recipient');
    expect((await req('/v1/session/invitations/preview', right.token, null, { code: r.code() })).status).toBe(403);
    expect((await req('/v1/session/invitations/preview', right.token, right.session.csrf, { code: r.code() })).status).toBe(200);
    expect((await req('/v1/session/invitations/accept', right.token, right.session.csrf, { code: r.code() })).status).toBe(200);
    expect((await req('/v1/session/invitations/accept', right.token, right.session.csrf, { code: r.code() })).status).toBe(404);
  });
  for (const roles of [[], ['*'], ['doctor', 'doctor'], ['admin','doctor','owner']]) it(`rejects unsupported role sets ${JSON.stringify(roles)}`, async () => {
    const r = rig(); await expect(r.invites.invite(r.admin, { ...r.input, roles: roles as ('admin' | 'doctor')[] })).rejects.toThrow('bad_request'); expect(r.mail).toEqual([]);
  });
});


it('two independent SQLite connections cannot accept one invitation into two accounts', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'protocol-invitations-')), r = rig(join(folder,'db.sqlite'));
  const workers: Worker[] = [];
  try {
    await r.invites.invite(r.admin, r.input); const secret = r.code(), one = r.login('one'), two = r.login('two');
    const flags = new SharedArrayBuffer(4);
    const tasks = [one,two].map(s => {
      const worker = new Worker(new URL('./support/invitationWorker.ts', import.meta.url), { execArgv: [], workerData: { path: join(folder,'db.sqlite'), sessionHash: s.session.hash, secret, flags } }); workers.push(worker);
      const ready = new Promise<void>((resolve,reject) => { worker.once('message', () => resolve()); worker.once('error',reject); });
      const result = new Promise<{ ok: boolean; error?: string }>((resolve,reject) => { worker.on('message', value => { if (value !== 'ready') resolve(value); }); worker.once('error',reject); });
      const done = new Promise<void>((resolve,reject) => { worker.once('exit', code => code === 0 ? resolve() : reject(Error('worker failed'))); worker.once('error',reject); });
      return { ready, result, done };
    });
    await Promise.all(tasks.map(t => t.ready)); Atomics.store(new Int32Array(flags),0,1); Atomics.notify(new Int32Array(flags),0);
    const results = await Promise.all(tasks.map(t => t.result)); await Promise.all(tasks.map(t => t.done));
    expect(results.filter(r => r.ok)).toHaveLength(1); expect(results.find(r => !r.ok)?.error).toBe('not_found');
    const winner = results[0]!.ok ? one : two, loser = results[0]!.ok ? two : one;
    expect(r.sessions.contexts(winner.session.accountId)).toHaveLength(1); expect(r.sessions.contexts(loser.session.accountId)).toHaveLength(0);
    expect(r.db.prepare("SELECT count(*) AS n FROM clinic_audit WHERE action = 'staff.invite.accept'").get()?.n).toBe(1);
  } finally { await Promise.all(workers.map(w => w.terminate())); r.store.close(); stores.splice(stores.indexOf(r.store),1); rmSync(folder,{recursive:true,force:true}); }
}, 15_000);

it('the seven-day deadline invalidates cached legacy actors at service entry without affecting another clinic', async () => {
  const r = rig(); await r.invites.invite(r.admin,r.input); const s = r.login('recipient'); r.invites.accept(s.session.hash,r.code());
  const cached = r.dir.authenticate(r.doctor.token)!; r.dir.cutover(r.admin,168); r.tick(168*3600_000);
  expect(r.dir.authenticate(r.doctor.token)).toBeNull(); expect(() => r.dir.require(cached,'plan.issue')).toThrow('unauthenticated');
  expect(r.dir.authenticate(r.other.token)).not.toBeNull();
});


it('housekeeping removes expired invitation contact data and retains category-only audit', async () => {
  const r = rig(); await r.invites.invite(r.admin,r.input); r.tick(INVITATION_MS + 30*86400_000 + 1); r.invites.housekeeping();
  expect(r.db.prepare('SELECT * FROM staff_invitations').all()).toEqual([]);
  const audit = JSON.stringify(r.db.prepare('SELECT * FROM clinic_audit').all()); expect(audit).toContain('staff.invite.create'); expect(audit).not.toContain(r.input.email); expect(audit).not.toContain(r.code());
});


it('rotating a credential invalidates cached legacy authority before any service mutation', () => {
  const r = rig(), cached = r.dir.authenticate(r.org.token)!;
  const next = r.dir.rotateToken(r.admin, r.org.adminId);
  expect(() => r.dir.addStaff(cached,{ displayName:'Denied cached actor',role:'doctor' })).toThrow('unauthenticated');
  expect(r.dir.authenticate(next)).not.toBeNull(); expect(r.dir.authenticate(r.org.token)).toBeNull();
});


const receipt = (scope: string, input: unknown, at: number, key = crypto.randomUUID()): Mutation => ({ scope, at,
  keyHash: createHash('sha256').update(key).digest('hex'), requestHash: createHash('sha256').update(JSON.stringify(input)).digest('hex') });
describe('actor-scoped mutation receipts and optimistic role edits', () => {
  it('replays the invitation result without a second email, rejects another payload, and never resurrects a revoked invitation', async () => {
    const r = rig(), m = receipt('admin/create',r.input,r.now());
    const one = await r.invites.invite(r.admin,r.input,m); expect(await r.invites.invite(r.admin,r.input,m)).toEqual(one); expect(r.mail).toHaveLength(1);
    await expect(r.invites.invite(r.admin,{...r.input,roles:['admin']},{...m,requestHash:'different'})).rejects.toThrow('mutation_conflict');
    r.invites.revoke(r.admin,one.id); expect(await r.invites.invite(r.admin,r.input,m)).toEqual(one); expect(r.mail).toHaveLength(1); expect(r.invites.list(r.admin)[0]?.state).toBe('revoked');
  });
  it('rejects a duplicate while SMTP is pending and replays only the committed result', async () => {
    const r = rig(); let release!: () => void, begun!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { begun = resolve; });
    const service = new StaffInvitations(r.db,r.dir,'https://app.test',async m => { r.mail.push(m); begun(); await wait; },r.now);
    const m = receipt('admin/create',r.input,r.now()), first = service.invite(r.admin,r.input,m); await ready;
    await expect(service.invite(r.admin,r.input,m)).rejects.toThrow('mutation_in_progress'); release(); const result = await first;
    expect(await service.invite(r.admin,r.input,m)).toEqual(result); expect(r.mail).toHaveLength(1);
  });
  it('does not resend on replay of a failed submission', async () => {
    const r = rig(), service = new StaffInvitations(r.db,r.dir,'https://app.test',async m => { r.mail.push(m); throw Error('synthetic failure'); },r.now);
    const m = receipt('admin/create',r.input,r.now()); await expect(service.invite(r.admin,r.input,m)).rejects.toThrow('unavailable');
    await expect(service.invite(r.admin,r.input,m)).rejects.toThrow('mutation_failed'); expect(r.mail).toHaveLength(1);
  });
  it('replays an accepted membership for that account only, without a second audit or membership', async () => {
    const r = rig(); await r.invites.invite(r.admin,r.input); const s = r.login('recipient'), other = r.login('other');
    const m = receipt(`${s.session.accountId}/accept`,{code:r.code()},r.now()), first = r.invites.accept(s.session.hash,r.code(),m);
    expect(r.invites.accept(s.session.hash,r.code(),m)).toEqual(first);
    expect(() => r.invites.accept(other.session.hash,r.code(),m)).toThrow('not_found');
    expect(r.db.prepare("SELECT count(*) AS n FROM clinic_audit WHERE action = 'staff.invite.accept'").get()?.n).toBe(1);
    r.sessions.revoke(s.session); expect(() => r.invites.accept(s.session.hash,r.code(),m)).toThrow('unauthorized');
  });
  it('checks role version once, replays the prior write, and refuses a stale different edit', () => {
    const r = rig(), version = r.dir.listStaff(r.admin).find(s=>s.id===r.doctor.memberId)!.rolesVersion!;
    const m = receipt('admin/roles',{id:r.doctor.memberId,roles:['admin','doctor'],version},r.now());
    r.dir.setRoles(r.admin,r.doctor.memberId,['admin','doctor'],version,m);
    r.dir.setRoles(r.admin,r.doctor.memberId,['admin','doctor'],version,m);
    const member = r.dir.listStaff(r.admin).find(s=>s.id===r.doctor.memberId)!; expect(member.rolesVersion).toBe(version+1); expect(member.roles).toEqual(['admin','doctor']);
    expect(() => r.dir.setRoles(r.admin,r.doctor.memberId,['doctor'],version)).toThrow('conflict');
    expect(() => r.dir.setRoles(r.admin,r.doctor.memberId,['doctor'],version,{...m,requestHash:'different'})).toThrow('mutation_conflict');
    expect(r.dir.listStaff(r.admin).find(s=>s.id===r.doctor.memberId)!.rolesVersion).toBe(version+1);
  });
  it('a lost cutoff response does not move or extend the deadline on retry', async () => {
    const r = rig(); await r.invites.invite(r.admin,r.input); const s = r.login('recipient'); r.invites.accept(s.session.hash,r.code());
    const m = receipt('admin/cutover',{graceHours:168},r.now()); r.dir.cutover(r.admin,168,m);
    const before = r.dir.authTransition(r.admin); r.tick(1000); r.dir.cutover(r.admin,168,m); expect(r.dir.authTransition(r.admin)).toEqual(before);
    expect(() => r.dir.cutover(r.admin,168)).toThrow('bad_request');
  });
  it('rolls back the mutation receipt together with a failed business audit', async () => {
    const r = rig(); await r.invites.invite(r.admin,r.input); const s = r.login('recipient'), m = receipt('recipient/accept',{code:r.code()},r.now());
    r.db.exec("CREATE TEMP TRIGGER fail_receipt BEFORE INSERT ON clinic_audit WHEN NEW.action = 'staff.invite.accept' BEGIN SELECT RAISE(ABORT, 'synthetic'); END");
    expect(() => r.invites.accept(s.session.hash,r.code(),m)).toThrow('synthetic'); expect(r.db.prepare('SELECT * FROM staff_mutations').all()).toEqual([]);
    r.db.exec('DROP TRIGGER fail_receipt'); expect(r.invites.accept(s.session.hash,r.code(),m)).toBeDefined();
  });
  it('HTTP requires the key and handles canonical request hashes without exposing request bodies', async () => {
    const r = rig(), cfg = { issuer: new URL('https://issuer.test/'), clientId:'synthetic',clientSecret:'synthetic',redirectUri:new URL('https://api.test/v1/auth/callback'),appOrigin:'https://app.test',mfaAmr:'mfa' };
    const app = createApp({store:r.store,origins:[cfg.appOrigin],clinic:r.dir,planDelivery:new PlanDelivery(r.db,r.dir,r.now),identity:{cfg,oidc:new Oidc(cfg),sessions:r.sessions},invitations:r.invites,now:()=>new Date(r.now())});
    const key = crypto.randomUUID(), headers = { Cookie:`__Host-psess=${r.adminLogin.token}`, Origin:cfg.appOrigin,'X-CSRF-Token':r.adminLogin.session.csrf,'X-Clinic-Id':r.org.orgId,'Content-Type':'application/json' };
    const req = (body:unknown,k?:string) => app.request('https://api.test/v1/clinic/invitations',{method:'POST',headers:{...headers,...(k?{'Idempotency-Key':k}:{})},body:JSON.stringify(body)});
    expect((await req(r.input)).status).toBe(400);
    const first = await req(r.input,key); expect(first.status).toBe(201); const result = await first.json();
    const reordered = {targetMemberId:r.input.targetMemberId,roles:r.input.roles,displayName:r.input.displayName,email:r.input.email};
    expect(await (await req(reordered,key)).json()).toEqual(result); expect(r.mail).toHaveLength(1);
    expect((await req({...r.input,roles:['admin']},key)).status).toBe(409);
    const records = JSON.stringify(r.db.prepare('SELECT * FROM staff_mutations').all()); expect(records).not.toContain(r.input.email); expect(records).not.toContain(r.code()); expect(records).not.toContain(key);
  });
});


it('accepting an invitation advances the role version so an old admin form cannot overwrite accepted roles', async () => {
  const r = rig(), oldVersion = r.dir.listStaff(r.admin).find(s=>s.id===r.doctor.memberId)!.rolesVersion!;
  await r.invites.invite(r.admin,{...r.input,roles:['admin','doctor']}); const s = r.login('recipient'); r.invites.accept(s.session.hash,r.code());
  expect(() => r.dir.setRoles(r.admin,r.doctor.memberId,['doctor'],oldVersion)).toThrow('conflict');
  const member = r.dir.listStaff(r.admin).find(s=>s.id===r.doctor.memberId)!; expect(member.roles).toEqual(['admin','doctor']); expect(member.rolesVersion).toBe(oldVersion+1);
});


it('24-hour mutation cleanup does not extend the original invitation expiry', async () => {
  const r = rig(), m = receipt('create',r.input,r.now()); const created = await r.invites.invite(r.admin,r.input,m);
  expect(r.db.prepare('SELECT expires_at FROM staff_mutations').get()?.expires_at).toBe(r.now()+86400_000);
  r.tick(86400_000); mutationHousekeeping(r.db,r.now());
  expect(r.db.prepare('SELECT * FROM staff_mutations').all()).toEqual([]);
  expect(r.db.prepare('SELECT expires_at FROM staff_invitations WHERE id = ?').get(created.id)?.expires_at).toBe(created.expiresAt);
});


it('zero-grace cutover uses one timestamp even when the clock advances during the transaction', async () => {
  const r = rig(); await r.invites.invite(r.admin,r.input); const s = r.login('recipient'); r.invites.accept(s.session.hash,r.code());
  let clock = r.now(); const moving = new ClinicDirectory(r.db,() => ++clock);
  moving.cutover(r.admin,0);
  const transition = r.db.prepare('SELECT migrated_at, legacy_until FROM clinic_auth_transitions WHERE org = ?').get(r.org.orgId)!;
  expect(transition.legacy_until).toBe(transition.migrated_at); expect(moving.authenticate(r.org.token)).toBeNull();
});


it('staff deactivation replays without a second audit or version change', async () => {
  const r = rig(), m = receipt('admin/deactivate',{id:r.doctor.memberId},r.now());
  r.dir.deactivate(r.admin,r.doctor.memberId,m); r.dir.deactivate(r.admin,r.doctor.memberId,m);
  expect(r.db.prepare("SELECT count(*) AS n FROM clinic_audit WHERE action = 'staff.deactivate'").get()?.n).toBe(1);
  expect(r.dir.listStaff(r.admin).find(s=>s.id===r.doctor.memberId)?.active).toBe(false);
});
