import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
import { ClinicDirectory } from '../src/clinic/directory.ts';
import { PlanDelivery } from '../src/clinic/delivery.ts';
import { Sessions, RECENT_MS } from '../src/identity/sessions.ts';
import { Oidc } from '../src/identity/oidc.ts';

const stores: Store[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); });
function rig(mfa = true) {
  const store = Store.migrated(':memory:'); stores.push(store);
  const db = store.database; let now = Date.now();
  const dir = new ClinicDirectory(db, () => now), sessions = new Sessions(db, () => now);
  const org = dir.createOrganization('Clinic A', 'Admin A'), admin = dir.authenticate(org.token)!;
  const doc = dir.addStaff(admin, { displayName: 'Doctor A', role: 'doctor' });
  const colleague = dir.addStaff(admin, { displayName: 'Doctor B', role: 'doctor' });
  const other = dir.createOrganization('Clinic B', 'Admin B');
  const cfg = { issuer: new URL('https://issuer.test/'), clientId: 'synthetic', clientSecret: 'synthetic',
    redirectUri: new URL('https://api.test/v1/auth/callback'), appOrigin: 'https://app.test', mfaAmr: 'mfa' };
  const identity = { cfg, sessions, oidc: new Oidc(cfg) };
  const delivery = new PlanDelivery(db, dir, () => now);
  const app = createApp({ store, clinic: dir, planDelivery: delivery, identity, origins: [cfg.appOrigin], now: () => new Date(now) });
  // Explicit fixture linking, never a product API or an inference from email/token.
  const login = (id: string, assurance = mfa) => {
    db.prepare("UPDATE accounts SET status = 'active' WHERE id = ?").run(id);
    db.prepare('INSERT INTO external_identities VALUES (?, ?, ?, ?)').run(cfg.issuer.href, id, id, now);
    const result = sessions.signIn({ issuer: cfg.issuer.href, subject: id, authTime: now, mfa: assurance, replacing: null });
    if (typeof result === 'string') throw Error(result); return result;
  };
  const signed = login(doc.memberId);
  const request = (path = '/me', options: { method?: string; body?: unknown; origin?: string; csrf?: string; token?: string; orgId?: string; bearer?: string } = {}) =>
    app.request(`https://api.test/v1/clinic${path}`, { method: options.method ?? 'GET', headers: {
      Cookie: `__Host-psess=${options.token ?? signed.token}`, Origin: options.origin ?? cfg.appOrigin,
      'X-Clinic-Id': options.orgId ?? org.orgId, ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
    }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
  const plan = { schemaVersion: 1, planId: crypto.randomUUID(), organizationId: org.orgId,
    issuedAt: '2026-10-29T12:00:00Z', clinician: { displayName: 'Untrusted client name', organizationName: 'Untrusted' },
    title: 'Synthetic plan', medications: [], restrictions: [], tests: [] };
  return { store, db, dir, sessions, delivery, app, org, admin, doc, colleague, other, signed, login, request, plan, tick: (ms: number) => { now += ms; } };
}

describe('ACCESS-04-A: clinical session boundary', () => {
  it('uses the exact active DB membership and issuer snapshot; author can inspect and revoke', async () => {
    const r = rig();
    const me = await r.request(); expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ displayName: 'Doctor A', organizationId: r.org.orgId, roles: ['doctor'] });
    const issue = await r.request('/plans', { method: 'POST', csrf: r.signed.session.csrf, body: { plan: r.plan, patientConsent: true } });
    expect(issue.status).toBe(201); const d = await issue.json();
    expect((await r.request(`/plans/${d.deliveryId}`)).status).toBe(200);
    expect((await r.request(`/plans/${d.deliveryId}`, { method: 'DELETE', csrf: r.signed.session.csrf })).status).toBe(200);
  });
  it('same-clinic colleague receives 404 for status/revoke with no side effects', async () => {
    const r = rig(), colleague = r.dir.authenticate(r.colleague.token)!;
    const d = r.delivery.issue(colleague, { plan: r.plan, patientConsent: true });
    const before = r.db.prepare('SELECT * FROM plan_delivery').all();
    for (const method of ['GET', 'DELETE']) expect((await r.request(`/plans/${d.deliveryId}`, { method, csrf: r.signed.session.csrf })).status).toBe(404);
    expect(r.db.prepare('SELECT * FROM plan_delivery').all()).toEqual(before);
    expect(r.db.prepare("SELECT account_id, result FROM auth_audit WHERE action = 'clinic.access'").all()).toEqual([{ account_id: r.doc.memberId, result: 'not_found' }, { account_id: r.doc.memberId, result: 'not_found' }]);
  });
  for (const options of [{ csrf: undefined }, { csrf: 'wrong' }, { origin: 'https://evil.test', csrf: 'wrong' }]) {
    it(`rejects unsafe mutation ${JSON.stringify(options)}`, async () => {
      const r = rig(); const response = await r.request('/plans', { method: 'POST', body: { plan: r.plan, patientConsent: true }, ...options });
      expect(response.status).toBe(403); expect(r.db.prepare('SELECT * FROM plan_delivery').all()).toHaveLength(0);
    });
  }
  it('does not fall back to bearer after an invalid cookie, and rejects mixed credentials', async () => {
    const r = rig();
    expect((await r.request('/me', { token: 'invalid', bearer: r.org.token })).status).toBe(403);
    expect((await r.request('/me', { token: 'invalid' })).status).toBe(401);
    expect((await r.app.request('https://api.test/v1/clinic/me', { headers: { Cookie: '__Host-psess=', Authorization: `Bearer ${r.org.token}` } })).status).toBe(401);
  });
  it('MFA is mandatory for clinical access', async () => { const r = rig(false); expect(await (await r.request()).json()).toEqual({ error: 'mfa_required' }); });
  it('requires an explicit context with multiple memberships, and cannot select another account\'s clinic', async () => {
    const r = rig();
    expect((await r.request('/me', { orgId: r.other.orgId })).status).toBe(403);
    r.db.prepare('UPDATE organization_memberships SET account_id = ? WHERE id = ?').run(r.doc.memberId, r.other.adminId);
    expect((await r.app.request('https://api.test/v1/clinic/me', { headers: { Cookie: `__Host-psess=${r.signed.token}` } })).status).toBe(403);
    expect(await (await r.request('/me', { orgId: r.other.orgId })).json()).toMatchObject({ displayName: 'Admin B', organizationId: r.other.orgId, roles: ['admin'] });
  });
  for (const change of ['account', 'membership', 'staff', 'session', 'roles']) {
    it(`rechecks ${change} at the service boundary after authentication`, () => {
      const r = rig(), actor = r.dir.authenticateSession(r.signed.session.hash, r.org.orgId);
      if (change === 'account') r.db.prepare("UPDATE accounts SET status = 'disabled' WHERE id = ?").run(r.doc.memberId);
      if (change === 'membership') r.db.prepare("UPDATE organization_memberships SET status = 'inactive' WHERE id = ?").run(r.doc.memberId);
      if (change === 'staff') r.db.prepare('UPDATE clinic_members SET active = 0 WHERE id = ?').run(r.doc.memberId);
      if (change === 'session') r.sessions.revoke(r.signed.session);
      if (change === 'roles') r.db.prepare('DELETE FROM organization_membership_roles WHERE membership_id = ?').run(r.doc.memberId);
      expect(() => r.delivery.issue(actor, { plan: r.plan, patientConsent: true })).toThrow();
      expect(r.db.prepare('SELECT * FROM plan_delivery').all()).toHaveLength(0);
    });
  }
  it('supports admin+doctor from DB, without widening the old bearer role', async () => {
    const r = rig(); r.db.prepare("INSERT INTO organization_membership_roles VALUES (?, 'admin')").run(r.doc.memberId);
    expect(await (await r.request()).json()).toMatchObject({ roles: ['admin', 'doctor'] });
    expect((await r.request('/staff')).status).toBe(200);
    expect(() => r.dir.listStaff(r.dir.authenticate(r.doc.token)!)).toThrow('forbidden');
  });
  it('admin-only session cannot issue a plan', async () => {
    const r = rig(), a = r.login(r.org.adminId);
    expect((await r.request('/plans', { method: 'POST', token: a.token, csrf: a.session.csrf, body: { plan: r.plan, patientConsent: true } })).status).toBe(403);
  });
  it('requires fresh signed auth_time at the staff write transaction, rejecting future, missing and stale values', () => {
    const r = rig(), a = r.login(r.org.adminId), actor = r.dir.authenticateSession(a.session.hash, r.org.orgId);
    const count = r.db.prepare('SELECT count(*) AS n FROM clinic_members').get();
    for (const time of [0, Date.now() + 3600_000, a.session.authTime - RECENT_MS - 1]) {
      r.db.prepare('UPDATE sessions SET auth_time = ? WHERE id_hash = ?').run(time, a.session.hash);
      expect(() => r.dir.addStaff(actor, { displayName: 'Denied', role: 'doctor' })).toThrow('step_up_required');
      expect(r.db.prepare('SELECT count(*) AS n FROM clinic_members').get()).toEqual(count);
    }
  });
  it('protects the last effective admin even when the legacy role is doctor', () => {
    const r = rig();
    r.db.prepare("INSERT INTO organization_membership_roles VALUES (?, 'admin')").run(r.doc.memberId);
    const actor = r.dir.authenticateSession(r.signed.session.hash, r.org.orgId);
    r.dir.deactivate(actor, r.org.adminId);
    expect(() => r.dir.deactivate(actor, r.doc.memberId)).toThrow('last_admin');
    expect(() => r.dir.setRole(actor, r.doc.memberId, 'doctor')).toThrow('last_admin');
  });
  it('can remove the old admin when another session admin with legacy doctor role is available', () => {
    const r = rig();
    r.db.prepare("INSERT INTO organization_membership_roles VALUES (?, 'admin')").run(r.doc.memberId);
    r.dir.deactivate(r.admin, r.org.adminId);
    expect(r.dir.profile(r.dir.authenticateSession(r.signed.session.hash, r.org.orgId)).roles).toContain('admin');
  });
  it('does not extend idle timeout from service checks', () => {
    const r = rig(), actor = r.dir.authenticateSession(r.signed.session.hash, r.org.orgId);
    r.tick(29 * 60_000); r.dir.profile(actor); r.tick(60_000);
    expect(() => r.dir.profile(actor)).toThrow('unauthorized');
  });
  it('credentialed CORS allows the exact app origin and required headers only on clinical/session routes', async () => {
    const r = rig();
    for (const origin of ['https://app.test', 'https://evil.test']) {
      const res = await r.app.request('https://api.test/v1/clinic/plans', { method: 'OPTIONS', headers: { Origin: origin,
        'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-Clinic-Id,X-CSRF-Token' } });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin === 'https://app.test' ? origin : null);
      if (origin === 'https://app.test') { expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true'); expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Clinic-Id'); }
    }
    for (const path of ['/v1/session/logout', '/v1/sessions/revoke-all']) {
      const pre = await r.app.request(`https://api.test${path}`, { method: 'OPTIONS', headers: { Origin: 'https://app.test',
        'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-csrf-token' } });
      expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('https://app.test'); expect(pre.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    }
    const redeem = await r.app.request('https://api.test/v1/clinic/plans/redeem', { method: 'OPTIONS', headers: { Origin: 'https://app.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    expect(redeem.headers.get('Access-Control-Allow-Origin')).toBe('https://app.test'); expect(redeem.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    const config = await r.app.request('https://api.test/v1/auth/config', { headers: { Origin: 'https://app.test' } });
    expect(config.headers.get('Access-Control-Allow-Origin')).toBe('https://app.test'); expect(await config.json()).toEqual({ enabled: true });
    const other = await r.app.request('https://api.test/health', { headers: { Origin: 'https://app.test' } });
    expect(other.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
});
