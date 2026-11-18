// Demo stand («ТЗ: демо клиники», step 1): its locks, the mock identity provider's whole sign-in, the seed and the reset.
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { demoGuard, DemoGuardError } from '../src/demo/guard.ts';
import { DEMO_CODE, DEMO_STAFF, demoIdp, idpConfig } from '../src/demo/idp.ts';
import { DEMO_CLINIC, demoReset } from '../src/demo/seed.ts';
import { Oidc, IdpRejected } from '../src/identity/oidc.ts';
import { identityConfig } from '../src/identity/config.ts';
import { Store } from '../src/store.ts';

describe('the locks', () => {
  it('DEMO=1 only on a demo host, signing in only through the demo provider', () => {
    expect(demoGuard({ DEMO: '1', APP_ORIGIN: 'https://demo.example.org', OIDC_ISSUER: 'https://idp.demo.example.org/' })).toEqual({ demo: true });
    expect(() => demoGuard({ DEMO: '1', APP_ORIGIN: 'https://protocol.beyondthesignal.to' })).toThrow(DemoGuardError);
    expect(() => demoGuard({ DEMO: '1', APP_ORIGIN: 'https://demo.example.org', OIDC_ISSUER: 'https://accounts.google.com/' })).toThrow(DemoGuardError);
    expect(() => demoGuard({ DEMO: 'yes' })).toThrow(DemoGuardError);
  });
  it('without DEMO=1 the demo provider is refused; production is untouched', () => {
    expect(() => demoGuard({ OIDC_ISSUER: 'https://idp.demo.example.org/' })).toThrow(DemoGuardError);
    expect(demoGuard({ APP_ORIGIN: 'https://protocol.beyondthesignal.to', OIDC_ISSUER: 'https://login.example.com/' })).toEqual({ demo: false });
    expect(demoGuard({})).toEqual({ demo: false });
  });
  it('the mock provider does not start outside the stand', () => {
    const ok = { DEMO: '1', DEMO_IDP_ORIGIN: 'https://idp.demo.example.org', DEMO_IDP_CLIENT_ID: 'demo-client', DEMO_IDP_CLIENT_SECRET: 'x'.repeat(32), DEMO_IDP_REDIRECT: 'https://api.demo.example.org/v1/auth/callback' };
    expect(idpConfig(ok).origin).toBe('https://idp.demo.example.org');
    expect(() => idpConfig({ ...ok, DEMO: undefined })).toThrow(DemoGuardError);
    expect(() => idpConfig({ ...ok, DEMO_IDP_ORIGIN: 'https://idp.example.org' })).toThrow(DemoGuardError);
    expect(() => idpConfig({ ...ok, DEMO_IDP_CLIENT_SECRET: 'short' })).toThrow(DemoGuardError);
  });
});

describe('the mock provider', async () => {
  const redirect = 'http://localhost:9/v1/auth/callback';
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  const cfg = idpConfig({ DEMO: '1', DEMO_IDP_ORIGIN: origin, DEMO_IDP_CLIENT_ID: 'demo-client', DEMO_IDP_CLIENT_SECRET: 's'.repeat(32), DEMO_IDP_REDIRECT: redirect });
  server.on('request', demoIdp(cfg));
  afterAll(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
  const env = (demo: boolean) => ({ CLINIC_IDENTITY_V2: 'on', OIDC_ISSUER: origin + '/', OIDC_REDIRECT_URI: redirect, APP_ORIGIN: 'http://localhost:4318',
    OIDC_CLIENT_ID: 'demo-client', OIDC_CLIENT_SECRET: 's'.repeat(32), ...(demo ? { DEMO: '1' } : {}) });
  const checks = { state: randomUUID(), nonce: randomUUID(), codeVerifier: 'v'.repeat(50), stepUp: false };

  it('an API outside the stand refuses to sign anyone in through it', async () => {
    await expect(new Oidc(identityConfig(env(false))!).authorizationUrl(checks)).rejects.toBeInstanceOf(IdpRejected);
  });

  it('on the stand: a staff member, the second step, a verified sign-in with MFA in amr', async () => {
    const oidc = new Oidc(identityConfig(env(true))!);
    const auth = await oidc.authorizationUrl(checks);
    expect(await (await fetch(auth)).text()).toContain('Ендокринолог (демо)');
    const second = await fetch(auth, { method: 'POST', body: new URLSearchParams({ as: 'demo-endo' }) });
    expect(await second.text()).toContain(DEMO_CODE);
    const wrong = await fetch(auth, { method: 'POST', body: new URLSearchParams({ as: 'demo-endo', code: '123456' }), redirect: 'manual' });
    expect(wrong.status).toBe(401);
    const done = await fetch(auth, { method: 'POST', body: new URLSearchParams({ as: 'demo-endo', code: DEMO_CODE }), redirect: 'manual' });
    expect(done.status).toBe(302);
    const signedIn = await oidc.verify(new URL(done.headers.get('location')!), checks);
    expect(signedIn).toMatchObject({ issuer: origin + '/', subject: 'demo-endo', amr: ['pwd', 'mfa'], verifiedEmail: 'endo@demo.invalid' });
    // a code is used once
    await expect(oidc.verify(new URL(done.headers.get('location')!), checks)).rejects.toBeInstanceOf(IdpRejected);
  });
});

describe('seed and reset', () => {
  it('«Демо-клініка» with three staff linked to the provider; a reset starts from scratch, old records gone', () => {
    const DB_PATH = `${mkdtempSync(`${tmpdir()}/demo-`)}/demo.db`;
    const env = { DEMO: '1', DB_PATH, OIDC_ISSUER: 'https://idp.demo.example.org/' };
    expect(() => demoReset({ ...env, DEMO: undefined })).toThrow(DemoGuardError);
    const first = demoReset(env);
    expect(first.staff.map((s) => s.subject)).toEqual(DEMO_STAFF.map((s) => s.subject));
    let store = Store.migrated(DB_PATH);
    expect(store.database.prepare('SELECT name FROM clinic_orgs').all()).toEqual([{ name: DEMO_CLINIC }]);
    expect(store.database.prepare("SELECT count(*) n FROM accounts WHERE status = 'active'").get()).toEqual({ n: 3 });
    expect(store.database.prepare('SELECT count(*) n FROM external_identities WHERE issuer = ?').get(env.OIDC_ISSUER)).toEqual({ n: 3 });
    store.database.prepare("INSERT INTO settings (k, v) VALUES ('demo-left-over', 'x')").run();
    store.close();
    const again = demoReset(env);
    expect(again.orgId).not.toBe(first.orgId);
    store = Store.migrated(DB_PATH);
    expect(store.database.prepare('SELECT count(*) n FROM clinic_orgs').get()).toEqual({ n: 1 });
    expect(store.database.prepare("SELECT count(*) n FROM settings WHERE k = 'demo-left-over'").get()).toEqual({ n: 0 });
    store.close();
  });
});
