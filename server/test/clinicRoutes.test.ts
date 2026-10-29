import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { ClinicDirectory } from '../src/clinic/directory.ts';
import { PlanDelivery } from '../src/clinic/delivery.ts';
import { Store } from '../src/store.ts';

function rig() {
  const store = new Store(':memory:');
  const clinic = new ClinicDirectory(store.database);
  const planDelivery = new PlanDelivery(store.database, clinic);
  const app = createApp({ store, origins: [], clinic, planDelivery });
  const a = clinic.createOrganization('Клініка А', 'Адмін А'), b = clinic.createOrganization('Клініка Б', 'Адмін Б');
  const call = async (token: string | undefined, method: string, path: string, body?: unknown) => {
    const r = await app.request(`/v1/clinic${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, cache: r.headers.get('cache-control'), json: await r.json() as Record<string, any> };
  };
  const plan = (orgId: string) => ({ schemaVersion: 1, planId: crypto.randomUUID(), organizationId: orgId, issuedAt: '2026-10-01T10:00:00+03:00',
    clinician: { displayName: 'Лікар', organizationName: 'Клініка А' }, title: 'План', medications: [], restrictions: [], tests: [] });
  return { app, call, a, b, plan, store };
}

describe('clinic API', () => {
  it('requires a valid token everywhere and never caches', async () => {
    const { call } = rig();
    for (const [m, p] of [['GET', '/me'], ['GET', '/staff'], ['GET', '/audit'], ['POST', '/plans']] as const) {
      expect((await call(undefined, m, p)).status).toBe(401);
      expect((await call('x'.repeat(43), m, p)).status).toBe(401);
    }
    const ok = await call(rig().a.token, 'GET', '/me');
    expect(ok.status).toBe(401); // a token from another database is unknown
  });
  it('admin manages staff; the new doctor then works with the returned token', async () => {
    const { call, a } = rig();
    const me = await call(a.token, 'GET', '/me');
    expect(me).toMatchObject({ status: 200, cache: 'no-store', json: { role: 'admin', displayName: 'Адмін А', organizationName: 'Клініка А', organizationId: a.orgId } });
    const added = await call(a.token, 'POST', '/staff', { displayName: 'Лікар', role: 'doctor' });
    expect(added.status).toBe(201);
    expect((await call(added.json.token, 'GET', '/me')).json.role).toBe('doctor');
    expect((await call(a.token, 'GET', '/staff')).json.staff).toHaveLength(2);
    expect((await call(a.token, 'POST', '/staff', { displayName: '', role: 'doctor' })).status).toBe(400);
    expect((await call(a.token, 'POST', '/staff', { displayName: 'X', role: 'root' })).status).toBe(400);
  });
  it('a doctor cannot manage staff or see the audit; an admin cannot issue plans', async () => {
    const { call, a, plan } = rig();
    const doc = (await call(a.token, 'POST', '/staff', { displayName: 'Лікар', role: 'doctor' })).json.token;
    expect((await call(doc, 'GET', '/staff')).status).toBe(403);
    expect((await call(doc, 'POST', '/staff', { displayName: 'Y', role: 'admin' })).status).toBe(403);
    expect((await call(doc, 'GET', '/audit')).status).toBe(403);
    expect((await call(a.token, 'POST', '/plans', { plan: plan(a.orgId), patientConsent: true })).status).toBe(403);
  });
  it('deactivation and token rotation take effect at once', async () => {
    const { call, a } = rig();
    const d = (await call(a.token, 'POST', '/staff', { displayName: 'Лікар', role: 'doctor' })).json;
    const rotated = (await call(a.token, 'POST', `/staff/${d.memberId}/token`)).json.token;
    expect((await call(d.token, 'GET', '/me')).status).toBe(401);
    expect((await call(rotated, 'GET', '/me')).status).toBe(200);
    expect((await call(a.token, 'DELETE', `/staff/${d.memberId}`)).status).toBe(200);
    expect((await call(rotated, 'GET', '/me')).status).toBe(401);
  });
  it('the last admin cannot be removed', async () => {
    const { call, a } = rig();
    expect((await call(a.token, 'DELETE', `/staff/${a.adminId}`)).status).toBe(409);
    expect((await call(a.token, 'PUT', `/staff/${a.adminId}/role`, { role: 'doctor' })).status).toBe(409);
  });
  it('another organization\'s members and deliveries answer 404, and bad ids too', async () => {
    const { call, a, b, plan } = rig();
    const doc = (await call(a.token, 'POST', '/staff', { displayName: 'Лікар', role: 'doctor' })).json.token;
    const other = (await call(b.token, 'POST', '/staff', { displayName: 'Інший', role: 'doctor' })).json;
    expect((await call(a.token, 'DELETE', `/staff/${other.memberId}`)).status).toBe(404);
    expect((await call(a.token, 'POST', `/staff/${other.memberId}/token`)).status).toBe(404);
    expect((await call(a.token, 'DELETE', '/staff/not-an-id')).status).toBe(404);
    const d = await call(doc, 'POST', '/plans', { plan: plan(a.orgId), patientConsent: true });
    expect(d.status).toBe(201);
    expect((await call(other.token, 'GET', `/plans/${d.json.deliveryId}`)).status).toBe(404);
    expect((await call(other.token, 'DELETE', `/plans/${d.json.deliveryId}`)).status).toBe(404);
    expect((await call(doc, 'GET', `/plans/${d.json.deliveryId}`)).json.status).toBe('pending');
  });
  it('a colleague of the same clinic gets 404 on status and revoke; the delivery stays pending for its author', async () => {
    const { app, call, a, plan } = rig();
    const author = (await call(a.token, 'POST', '/staff', { displayName: 'Автор', role: 'doctor' })).json.token;
    const colleague = (await call(a.token, 'POST', '/staff', { displayName: 'Колега', role: 'doctor' })).json.token;
    const d = (await call(author, 'POST', '/plans', { plan: plan(a.orgId), patientConsent: true })).json;
    expect((await call(colleague, 'GET', `/plans/${d.deliveryId}`))).toMatchObject({ status: 404, json: { error: 'not_found' } });
    expect((await call(colleague, 'DELETE', `/plans/${d.deliveryId}`))).toMatchObject({ status: 404, json: { error: 'not_found' } });
    expect((await call(a.token, 'GET', `/plans/${d.deliveryId}`)).status).toBe(403);
    expect((await call(author, 'GET', `/plans/${d.deliveryId}`)).json.status).toBe('pending');
    const r = await app.request('/v1/clinic/plans/redeem', { method: 'POST', body: JSON.stringify({ code: d.code }), headers: { 'Content-Type': 'application/json' } });
    expect(r.status).toBe(200);
    expect((await call(author, 'GET', `/plans/${d.deliveryId}`)).json.status).toBe('redeemed');
  });
  it('the author sees tampered and cannot revoke it; stats count it apart from redeemed', async () => {
    const { app, call, a, plan, store } = rig();
    const doc = (await call(a.token, 'POST', '/staff', { displayName: 'Лікар', role: 'doctor' })).json.token;
    const d = (await call(doc, 'POST', '/plans', { plan: plan(a.orgId), patientConsent: true })).json;
    store.database.prepare("UPDATE plan_delivery SET plan = replace(plan, 'План', 'Інший')").run();
    const r = await app.request('/v1/clinic/plans/redeem', { method: 'POST', body: JSON.stringify({ code: d.code }), headers: { 'Content-Type': 'application/json' } });
    expect(r.status).toBe(410);
    expect((await call(doc, 'GET', `/plans/${d.deliveryId}`)).json.status).toBe('tampered');
    expect((await call(doc, 'DELETE', `/plans/${d.deliveryId}`)).status).toBe(404);
    expect((await call(doc, 'GET', `/plans/${d.deliveryId}`)).json.status).toBe('tampered');
    expect((await call(a.token, 'GET', '/stats')).json).toMatchObject({ issued: 1, tampered: 1, redeemed: 0, pending: 0 });
  });
  it('issues a plan with consent, only for the own organization, and can revoke it', async () => {
    const { app, call, a, b, plan } = rig();
    const doc = (await call(a.token, 'POST', '/staff', { displayName: 'Лікар', role: 'doctor' })).json.token;
    expect((await call(doc, 'POST', '/plans', { plan: plan(a.orgId), patientConsent: false })).status).toBe(400);
    expect((await call(doc, 'POST', '/plans', { plan: plan(b.orgId), patientConsent: true })).status).toBe(400);
    const d = (await call(doc, 'POST', '/plans', { plan: plan(a.orgId), patientConsent: true })).json;
    expect(Object.keys(d).sort()).toEqual(['code', 'deliveryId', 'expiresAt']);
    expect((await call(doc, 'DELETE', `/plans/${d.deliveryId}`)).status).toBe(200);
    const r = await app.request('/v1/clinic/plans/redeem', { method: 'POST', body: JSON.stringify({ code: d.code }), headers: { 'Content-Type': 'application/json' } });
    expect(r.status).toBe(410);
  });
  it('the audit log lists actions by ids, without plan content', async () => {
    const { call, a, plan } = rig();
    const doc = (await call(a.token, 'POST', '/staff', { displayName: 'Лікар', role: 'doctor' })).json.token;
    await call(doc, 'POST', '/plans', { plan: plan(a.orgId), patientConsent: true });
    const log = JSON.stringify((await call(a.token, 'GET', '/audit')).json);
    expect(log).toContain('plan.issue');
    expect(log).not.toMatch(/План|Лікар/);
  });
  it('is absent without clinic support', async () => {
    const app = createApp({ store: new Store(':memory:'), origins: [] });
    expect((await app.request('/v1/clinic/me')).status).toBe(404);
  });

  it('stats: admins only, own organization only, numbers without content', async () => {
    const { call, a, b, plan } = rig();
    const doc = (await call(a.token, 'POST', '/staff', { displayName: 'Лікар', role: 'doctor' })).json.token;
    const other = (await call(b.token, 'POST', '/staff', { displayName: 'Інший', role: 'doctor' })).json.token;
    const one = (await call(doc, 'POST', '/plans', { plan: plan(a.orgId), patientConsent: true })).json;
    await call(doc, 'POST', '/plans', { plan: plan(a.orgId), patientConsent: true });
    await call(doc, 'DELETE', `/plans/${one.deliveryId}`);
    await call(other, 'POST', '/plans', { plan: plan(b.orgId), patientConsent: true });
    expect((await call(doc, 'GET', '/stats')).status).toBe(403);
    const s = (await call(a.token, 'GET', '/stats?days=7')).json;
    expect(s).toMatchObject({ days: 7, issued: 2, pending: 1, revoked: 1, redeemed: 0, expired: 0 });
    expect(s.byDoctor).toEqual([{ memberId: expect.any(String), displayName: 'Лікар', issued: 2 }]);
    expect(JSON.stringify(s)).not.toMatch(/План|code/);
  });
});
