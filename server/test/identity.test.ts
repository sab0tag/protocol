import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { ClinicDirectory } from '../src/clinic/directory.ts';
import { PlanDelivery } from '../src/clinic/delivery.ts';
import { Sessions, ABSOLUTE_MS, IDLE_MS, digest } from '../src/identity/sessions.ts';
import { auth0Provider, configFromEnv } from '../src/identity/oidc.ts';
import { Store } from '../src/store.ts';
import { fakeOidc, type FakeClaims } from './support/fakeOidc.ts';

const stores: Store[] = [], closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); for (const store of stores.splice(0)) store.close(); });
const core = (live = false) => { const store = Store.migrated(':memory:'); stores.push(store); let fixed = Date.now(), offset = 0;
  const now = () => live ? Date.now() + offset : fixed;
  const sessions = new Sessions(store.database, now), dir = new ClinicDirectory(store.database, now);
  return { store, db: store.database, sessions, dir, tick: (ms: number) => { if (live) offset += ms; else fixed += ms; }, now }; };
const verified = (at: number, sub = 'doctor') => ({ issuer: 'https://synthetic.eu.auth0.com/', subject: sub, authTime: at, mfa: true });

describe('server sessions', () => {
  it('rolls identity/session/audit back together on audit failure, including step-up rotation', () => {
    const r = core();
    const block = () => r.db.exec("CREATE TEMP TRIGGER block_identity_audit BEFORE INSERT ON identity_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    block(); expect(() => r.sessions.establish(verified(r.now()), null)).toThrow('audit unavailable');
    for (const table of ['accounts', 'external_identities', 'identity_sessions', 'identity_audit']) expect(r.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n).toBe(0);
    r.db.exec('DROP TRIGGER block_identity_audit');
    const prior = r.sessions.establish(verified(r.now()), null); block();
    expect(() => r.sessions.establish(verified(r.now()), prior.session.id_hash)).toThrow('audit unavailable');
    expect(() => r.sessions.authenticate(prior.token)).not.toThrow();
    expect(r.db.prepare('SELECT COUNT(*) AS n FROM identity_sessions').get()?.n).toBe(1);
  });
  it('cleans expired attempts and unusable sessions without deleting active sessions or audit history', () => {
    const r = core(), old = r.sessions.establish(verified(r.now()), null), a = r.sessions.begin('nonce', 'verifier');
    r.sessions.claim(a.state, a.browser);
    expect(r.db.prepare('SELECT nonce, verifier FROM identity_login_attempts').get()).toEqual({ nonce: '', verifier: '' });
    r.tick(IDLE_MS);
    const current = r.sessions.establish(verified(r.now(), 'current'), null), audit = r.db.prepare('SELECT * FROM identity_audit').all();
    r.sessions.cleanup();
    expect(() => r.sessions.authenticate(old.token)).toThrow('unauthorized');
    expect(() => r.sessions.authenticate(current.token)).not.toThrow();
    expect(r.db.prepare('SELECT COUNT(*) AS n FROM identity_login_attempts').get()?.n).toBe(0);
    expect(r.db.prepare('SELECT * FROM identity_audit').all()).toEqual(audit);
  });
  it('creates separate active accounts by exact issuer/subject; never claims a provisional staff account by contact/name', () => {
    const { sessions, now, db, dir } = core();
    const old = dir.createOrganization('Clinic', 'doctor');
    const first = sessions.establish(verified(now()), null), repeat = sessions.establish(verified(now()), null);
    const otherSub = sessions.establish(verified(now(), 'other'), null);
    const otherIssuer = sessions.establish({ ...verified(now()), issuer: 'https://other.eu.auth0.com/' }, null);
    expect(first.session.account_id).toBe(repeat.session.account_id);
    expect(new Set([first.session.account_id, otherSub.session.account_id, otherIssuer.session.account_id]).size).toBe(3);
    expect(first.session.account_id).not.toBe(old.adminId);
    expect(sessions.contexts(first.session.account_id)).toEqual([]);
    expect(db.prepare('SELECT status FROM accounts WHERE id = ?').get(old.adminId)?.status).toBe('pending_link');
    const stored = JSON.stringify(db.prepare('SELECT * FROM identity_sessions').all());
    expect(stored).not.toContain(first.token); expect(stored).not.toContain('access_token');
  });
  it('enforces idle and absolute expiry independently; service checks do not extend idle time', () => {
    const r = core(), one = r.sessions.establish(verified(r.now()), null);
    r.tick(IDLE_MS - 1); r.sessions.require(one.session.id_hash); r.tick(1);
    expect(() => r.sessions.require(one.session.id_hash)).toThrow('unauthorized');
    const two = r.sessions.establish(verified(r.now(), 'two'), null);
    for (let i = 0; i < 36; i++) { r.tick(20 * 60_000); if (i < 35) r.sessions.authenticate(two.token); }
    expect(() => r.sessions.authenticate(two.token)).toThrow('unauthorized');
    expect(36 * 20 * 60_000).toBe(ABSOLUTE_MS);
  });
  it('requires actual MFA and 10-minute freshness, rejects future auth times, and rotates/revokes on same-identity step-up', () => {
    const r = core(), one = r.sessions.establish(verified(r.now()), null);
    r.tick(600_001);
    expect(() => r.sessions.require(one.session.id_hash, { fresh: true })).toThrow('step_up_required');
    const next = r.sessions.establish(verified(r.now()), one.session.id_hash);
    expect(next.token).not.toBe(one.token); expect(() => r.sessions.authenticate(one.token)).toThrow('unauthorized');
    expect(() => r.sessions.require(next.session.id_hash, { fresh: true, mfa: true })).not.toThrow();
    expect(() => r.sessions.establish({ ...verified(r.now()), authTime: r.now() + 1 }, null)).toThrow('invalid_login');
    const noMfa = r.sessions.establish({ ...verified(r.now()), mfa: false }, null);
    expect(() => r.sessions.require(noMfa.session.id_hash, { mfa: true })).toThrow('mfa_required');
    const before = r.db.prepare('SELECT COUNT(*) AS n FROM accounts').get()?.n;
    expect(() => r.sessions.establish(verified(r.now(), 'switched'), next.session.id_hash)).toThrow('invalid_login');
    expect(r.db.prepare('SELECT COUNT(*) AS n FROM accounts').get()?.n).toBe(before);
    expect(() => r.sessions.authenticate(next.token)).not.toThrow();
  });
  it('revocation and account disable invalidate cached session references immediately; revoke-all leaves other accounts alone', () => {
    const r = core(), a = r.sessions.establish(verified(r.now()), null), b = r.sessions.establish(verified(r.now()), null), c = r.sessions.establish(verified(r.now(), 'other'), null);
    r.sessions.revoke(a.session.id_hash, true);
    for (const s of [a, b]) expect(() => r.sessions.require(s.session.id_hash)).toThrow('unauthorized');
    expect(() => r.sessions.authenticate(c.token)).not.toThrow();
    r.db.prepare("UPDATE accounts SET status = 'disabled' WHERE id = ?").run(c.session.account_id);
    expect(() => r.sessions.require(c.session.id_hash)).toThrow('unauthorized');
  });
  it('binds one-time state to the initiating browser, rejects replay and expired attempts', () => {
    const r = core(), a = r.sessions.begin('nonce', 'verifier');
    expect(() => r.sessions.claim(a.state, 'x'.repeat(43))).toThrow('invalid_login');
    expect(r.sessions.claim(a.state, a.browser)).toMatchObject({ nonce: 'nonce', verifier: 'verifier' });
    expect(() => r.sessions.claim(a.state, a.browser)).toThrow('invalid_login');
    const b = r.sessions.begin('n', 'v'); r.tick(300_000);
    expect(() => r.sessions.claim(b.state, b.browser)).toThrow('invalid_login');
  });
  it('CSRF rejects missing/foreign origins, missing tokens and non-ASCII tokens without throwing buffer errors', () => {
    const r = core(), a = r.sessions.establish(verified(r.now()), null), origin = 'https://app.invalid';
    for (const [csrf, from] of [[undefined, origin], [a.session.csrf_secret, undefined], [a.session.csrf_secret, 'https://evil.invalid'], ['я'.repeat(43), origin]]) {
      expect(() => r.sessions.csrf(a.session, csrf, from, origin)).toThrow('forbidden');
    }
    expect(() => r.sessions.csrf(a.session, a.session.csrf_secret, origin, origin)).not.toThrow();
  });
});

async function linked() {
  const r = await rig(), logged = await r.login();
  expect(logged.end.status).toBe(302);
  const me = await (await r.call('/v1/session', { headers: { Cookie: logged.cookie! } })).json() as { accountId: string; csrfToken: string };
  const org = r.dir.createOrganization('Linked clinic', 'Legacy admin'), legacyAdmin = r.dir.authenticate(org.token)!;
  const staff = r.dir.addStaff(legacyAdmin, { displayName: 'Linked doctor', role: 'doctor' });
  r.db.prepare('UPDATE organization_memberships SET account_id = ? WHERE id = ?').run(me.accountId, staff.memberId);
  const headers = { Cookie: logged.cookie!, Origin: r.origin, 'X-CSRF-Token': me.csrfToken, 'X-Clinic-Id': org.orgId };
  const plan = { schemaVersion: 1, planId: crypto.randomUUID(), organizationId: org.orgId, issuedAt: new Date().toISOString(),
    clinician: { displayName: 'Declared', organizationName: 'Declared' }, title: 'Synthetic session plan', medications: [], restrictions: [], tests: ['Synthetic test'] };
  const actor = r.dir.authenticateSession(digest(logged.cookie!.split('=')[1]!), org.orgId);
  const clinic = (method: string, path: string, body?: unknown, h: Record<string, string> = headers) => r.call('/v1/clinic' + path, {
    method, headers: { ...h, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { ...r, logged, me, org, staff, actor, headers, plan, clinic };
}

describe('session-backed clinical authority', () => {
  it('uses live multi-role membership without widening legacy tokens; removing doctor retains admin functions only', async () => {
    const r = await linked();
    expect((await r.clinic('GET', '/staff')).status).toBe(403); // provider's signed admin claim is not Protocol authority
    r.db.prepare("INSERT INTO organization_membership_roles VALUES (?, 'admin')").run(r.staff.memberId);
    expect((await r.clinic('GET', '/staff')).status).toBe(200);
    expect((await r.clinic('POST', '/plans', { plan: r.plan, patientConsent: true })).status).toBe(201);
    expect((await r.clinic('GET', '/stats')).status).toBe(200);
    expect((await r.clinic('GET', '/stats', undefined, { Authorization: `Bearer ${r.staff.token}` })).status).toBe(403);
    r.db.prepare("DELETE FROM organization_membership_roles WHERE membership_id = ? AND role = 'doctor'").run(r.staff.memberId);
    expect((await r.clinic('POST', '/plans', { plan: r.plan, patientConsent: true })).status).toBe(403);
    expect((await r.clinic('GET', '/stats')).status).toBe(200);
  });
  it('requires CSRF and matching Origin for cookie writes and never falls back to legacy after cookie failure', async () => {
    const r = await linked();
    const before = r.db.prepare('SELECT COUNT(*) AS n FROM plan_delivery').get()?.n;
    for (const headers of [{ Cookie: r.logged.cookie! }, { ...r.headers, Origin: 'https://evil.invalid' }, { ...r.headers, 'X-CSRF-Token': 'é'.repeat(43) }]) {
      expect((await r.clinic('POST', '/plans', { plan: r.plan, patientConsent: true }, headers)).status).toBe(403);
    }
    expect(r.db.prepare('SELECT COUNT(*) AS n FROM plan_delivery').get()?.n).toBe(before);
    for (const Cookie of [r.logged.cookie!, '__Host-protocol-session=', '__Host-protocol-session=invalid']) {
      const response = await r.clinic('GET', '/me', undefined, { Cookie, Authorization: `Bearer ${r.staff.token}` });
      expect([401, 403]).toContain(response.status);
    }
  });
  for (const disabled of ['session', 'account', 'membership', 'staff'] as const) it(`rejects cached actors and the next HTTP request after ${disabled} disable`, async () => {
    const r = await linked(), d = r.delivery.issue(r.actor, { plan: r.plan, patientConsent: true });
    if (disabled === 'session') r.sessions.revoke(r.actor.session!.hash, false);
    if (disabled === 'account') r.db.prepare("UPDATE accounts SET status = 'disabled' WHERE id = ?").run(r.me.accountId);
    if (disabled === 'membership') r.db.prepare("UPDATE organization_memberships SET status = 'inactive' WHERE id = ?").run(r.staff.memberId);
    if (disabled === 'staff') r.db.prepare('UPDATE clinic_members SET active = 0 WHERE id = ?').run(r.staff.memberId);
    expect(() => r.delivery.status(r.actor, d.deliveryId)).toThrow();
    expect(() => r.delivery.revoke(r.actor, d.deliveryId)).toThrow();
    expect([401, 403]).toContain((await r.clinic('GET', '/me')).status);
    expect(r.db.prepare('SELECT status FROM plan_delivery WHERE id = ?').get(d.deliveryId)?.status).toBe('pending');
  });
  it('filters clinic contexts by account and requires an explicit selector when more than one is active', async () => {
    const r = await linked(), other = r.dir.createOrganization('Other clinic', 'Other admin');
    r.db.prepare("INSERT INTO organization_memberships VALUES ('second', ?, ?, NULL, 'active', ?)").run(r.me.accountId, other.orgId, r.now());
    r.db.exec("INSERT INTO organization_membership_roles VALUES ('second', 'admin')");
    expect((await r.clinic('GET', '/me', undefined, { Cookie: r.logged.cookie! })).status).toBe(403);
    expect((await r.clinic('GET', '/me', undefined, { ...r.headers, 'X-Clinic-Id': crypto.randomUUID() })).status).toBe(403);
    expect((await r.clinic('GET', '/me')).status).toBe(200);
    expect((await r.clinic('GET', '/me', undefined, { ...r.headers, 'X-Clinic-Id': other.orgId })).status).toBe(403); // no staff shadow before ACCESS-04
  });
  it('keeps author-only status/revoke for session doctors in the same clinic', async () => {
    const r = await linked(), colleague = r.dir.authenticate(r.dir.addStaff(r.dir.authenticate(r.org.token)!, { displayName: 'Colleague', role: 'doctor' }).token)!;
    const d = r.delivery.issue(colleague, { plan: r.plan, patientConsent: true });
    expect((await r.clinic('GET', `/plans/${d.deliveryId}`)).status).toBe(404);
    expect((await r.clinic('DELETE', `/plans/${d.deliveryId}`)).status).toBe(404);
    expect(r.delivery.status(colleague, d.deliveryId)).toBe('pending');
  });
  it('checks fresh authentication inside staff mutations; step-up rotates the cookie and permits retry', async () => {
    const r = await linked();
    expect((await r.clinic('GET', '/staff')).status).toBe(403); // provider's signed admin claim is not Protocol authority
    r.db.prepare("INSERT INTO organization_membership_roles VALUES (?, 'admin')").run(r.staff.memberId);
    r.db.prepare('UPDATE identity_sessions SET auth_time = ? WHERE account_id = ?').run(r.now() - 600_001, r.me.accountId);
    expect((await r.clinic('GET', '/staff')).status).toBe(200);
    const denied = await r.clinic('POST', '/staff', { displayName: 'New staff', role: 'doctor' });
    expect(denied.status).toBe(403); expect(await denied.json()).toEqual({ error: 'step_up_required' });
    const next = await r.login({ cookie: r.logged.cookie, stepUp: true }); expect(next.end.status).toBe(302);
    expect((await r.call('/v1/session', { headers: { Cookie: r.logged.cookie! } })).status).toBe(401);
    const session = await (await r.call('/v1/session', { headers: { Cookie: next.cookie! } })).json() as { csrfToken: string };
    expect((await r.clinic('POST', '/staff', { displayName: 'New staff', role: 'doctor' }, { ...r.headers, Cookie: next.cookie!, 'X-CSRF-Token': session.csrfToken })).status).toBe(201);
  });
  it('does not remove the final effective membership admin whose legacy role is doctor', async () => {
    const r = await linked();
    expect((await r.clinic('GET', '/staff')).status).toBe(403); // provider's signed admin claim is not Protocol authority
    r.db.prepare("INSERT INTO organization_membership_roles VALUES (?, 'admin')").run(r.staff.memberId);
    r.db.prepare("UPDATE accounts SET status = 'disabled' WHERE id = ?").run(r.org.adminId);
    expect((await r.clinic('DELETE', `/staff/${r.staff.memberId}`)).status).toBe(409);
    expect((await r.clinic('PUT', `/staff/${r.staff.memberId}/role`, { role: 'doctor' })).status).toBe(409);
  });
});

async function rig(claims: FakeClaims = {}) {
  const fake = await fakeOidc(claims); closers.push(fake.close);
  const r = core(true), origin = 'https://app.invalid';
  const provider = await auth0Provider({ issuer: fake.issuer, clientId: fake.clientId, clientSecret: fake.clientSecret, publicOrigin: origin }, { loopbackTestIssuer: true });
  const identity = { sessions: r.sessions, provider, origin };
  const delivery = new PlanDelivery(r.db, r.dir, r.now);
  const app = createApp({ store: r.store, origins: [], clinic: r.dir, planDelivery: delivery, identity });
  const call = (path: string, init: RequestInit = {}) => app.request(path, init);
  const login = async (options: { cookie?: string; stepUp?: boolean; accept?: string } = {}) => {
    const start = await call(`/v1/identity/login${options.stepUp ? '?step_up=1' : ''}`, { headers: options.cookie ? { Cookie: options.cookie } : {} });
    const attemptCookie = start.headers.get('set-cookie')!.split(';')[0]!;
    const url = new URL(start.headers.get('location')!); url.searchParams.set('as', 'doctor');
    const authorization = await fetch(url, { redirect: 'manual' });
    const callback = new URL(authorization.headers.get('location')!);
    const end = await call(callback.pathname + callback.search, { headers: { Cookie: attemptCookie, ...(options.accept ? { Accept: options.accept } : {}) } });
    return { start, end, callback: callback.pathname + callback.search, attemptCookie, cookie: end.headers.getSetCookie().find(x => x.startsWith('__Host-protocol-session='))?.split(';')[0] };
  };
  return { ...r, fake, app, identity, call, login, origin, delivery };
}

describe('OIDC BFF HTTP integration', () => {
  it('renders a safe retry path for browser callback failures and logs a category without attacker/provider data', async () => {
    const r = await rig({ amr: ['pwd'] }), logged = await r.login({ accept: 'text/html' });
    expect(logged.end.status).toBe(403);
    const html = await logged.end.text(); expect(html).toContain('Повернутися до входу'); expect(html).not.toContain('synthetic-access-token');
    expect(logged.end.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(r.db.prepare('SELECT account_id, action FROM identity_audit').all()).toEqual([{ account_id: null, action: 'login_failed' }]);
  });
  it('validates signed code+PKCE+nonce+state and rotates opaque secure cookies; provider tokens never reach the browser/session DB', async () => {
    const r = await rig(), logged = await r.login();
    expect(logged.end.status).toBe(302); expect(logged.end.headers.get('location')).toBe(r.origin + '/#/clinic');
    const header = logged.end.headers.getSetCookie().find(x => x.startsWith('__Host-protocol-session='))!;
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(header).toContain(flag);
    expect(header).not.toContain('Domain='); expect(header).not.toContain('synthetic-access-token');
    const session = await r.call('/v1/session', { headers: { Cookie: logged.cookie! } });
    expect(session.status).toBe(200); expect(session.headers.get('cache-control')).toBe('no-store');
    expect(await session.json()).toMatchObject({ mfa: true, contexts: [], csrfToken: expect.any(String) });
    expect((await r.call(logged.callback, { headers: { Cookie: logged.attemptCookie } })).status).toBe(400);
    expect(JSON.stringify(r.db.prepare('SELECT * FROM identity_sessions').all())).not.toContain('synthetic-access-token');
    expect(r.db.prepare('SELECT COUNT(*) AS n FROM organization_memberships').get()?.n).toBe(0);
  });
  for (const [name, claims] of Object.entries({ missingMfa: { amr: ['pwd'] }, badNonce: { nonce: 'wrong' }, wrongIssuer: { issuer: 'https://evil.invalid/' },
    wrongAudience: { audience: 'other-client' }, badSignature: { badSignature: true }, badAlgorithm: { alg: 'HS256' }, staleAuth: { authOffsetS: -601 }, futureAuth: { authOffsetS: 120 } })) {
    it(`refuses ${name} without creating a session or clinical authority`, async () => {
      const r = await rig(claims), logged = await r.login();
      expect([400, 403]).toContain(logged.end.status); expect(logged.cookie).toBeUndefined();
      expect(r.db.prepare('SELECT COUNT(*) AS n FROM identity_sessions').get()?.n).toBe(0);
      expect(r.db.prepare('SELECT COUNT(*) AS n FROM accounts').get()?.n).toBe(0);
    });
  }
  it('fails closed on an unknown key during the SDK cooldown, then refreshes JWKS after rotation', async () => {
    const r = await rig(); expect((await r.login()).end.status).toBe(302);
    r.fake.rotate(); expect((await r.login()).end.status).toBe(400);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(r.now() + 61_000);
    try { expect((await r.login()).end.status).toBe(302); } finally { clock.mockRestore(); }
  });
  it('requires browser-bound callback state, single parameters and the PKCE verifier', async () => {
    const r = await rig(), start = await r.call('/v1/identity/login');
    const authorizationUrl = new URL(start.headers.get('location')!); authorizationUrl.searchParams.set('as', 'doctor');
    const response = await fetch(authorizationUrl, { redirect: 'manual' });
    const callback = new URL(response.headers.get('location')!);
    expect((await r.call(callback.pathname + callback.search)).status).toBe(400);
    const cookie = start.headers.get('set-cookie')!.split(';')[0]!;
    const duplicate = callback.pathname + callback.search + '&state=other';
    expect((await r.call(duplicate, { headers: { Cookie: cookie } })).status).toBe(400);
    r.db.prepare("UPDATE identity_login_attempts SET verifier = 'wrong-verifier'").run();
    expect((await r.call(callback.pathname + callback.search, { headers: { Cookie: cookie } })).status).toBe(400);
  });
  it('logout/revoke-all need CSRF and preserve unrelated vault data', async () => {
    const r = await rig(), a = await r.login(), b = await r.login();
    r.db.prepare("INSERT INTO vaults (id, auth, created) VALUES ('synthetic', 'h', 'now')").run();
    const me = await (await r.call('/v1/session', { headers: { Cookie: a.cookie! } })).json() as { csrfToken: string };
    for (const headers of [{ Cookie: a.cookie! }, { Cookie: a.cookie!, Origin: 'https://evil.invalid', 'X-CSRF-Token': me.csrfToken }] as Record<string, string>[]) {
      expect((await r.call('/v1/sessions/revoke-all', { method: 'POST', headers })).status).toBe(403);
    }
    expect((await r.call('/v1/sessions/revoke-all', { method: 'POST', headers: { Cookie: a.cookie!, Origin: r.origin, 'X-CSRF-Token': me.csrfToken } })).status).toBe(200);
    for (const cookie of [a.cookie!, b.cookie!]) expect((await r.call('/v1/session', { headers: { Cookie: cookie } })).status).toBe(401);
    expect(r.db.prepare('SELECT id FROM vaults').get()?.id).toBe('synthetic');
    expect(r.db.prepare("SELECT COUNT(*) AS n FROM identity_audit WHERE action = 'revoke_all'").get()?.n).toBe(1);
  });
  it('is disabled by default, refuses insecure production configuration, and rate-limits login', async () => {
    const r = core(), app = createApp({ store: r.store, origins: [] });
    expect(await (await app.request('/v1/identity/config')).json()).toMatchObject({ enabled: false });
    expect((await app.request('/v1/identity/login')).status).toBe(503);
    expect(configFromEnv({})).toBeNull();
    expect(() => configFromEnv({ IDENTITY_ENABLED: 'true', AUTH0_ISSUER: 'http://localhost:9999' })).toThrow();
    const oidc = await rig();
    for (let i = 0; i < 20; i++) expect((await oidc.call('/v1/identity/login')).status).toBe(302);
    expect((await oidc.call('/v1/identity/login')).status).toBe(429);
  });
});
