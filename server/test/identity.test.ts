import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { identityConfig, IdentityConfigError, type IdentityConfig } from '../src/identity/config.ts';
import { Oidc } from '../src/identity/oidc.ts';
import { ABSOLUTE_MS, clinicalAccess, IDLE_MS, Sessions } from '../src/identity/sessions.ts';
import { Store } from '../src/store.ts';
import { startIdp, type Idp, type NextSignIn } from './support/oidcProvider.ts';

// ACCESS-03: OIDC sign-in through the API, server sessions, CSRF, logout/revoke, step-up. Against a local provider.
const APP = 'https://app.test';
const open: Idp[] = [];
afterEach(async () => { for (const i of open.splice(0)) await i.close(); });

async function rig(issuerOverride?: string) {
  const idp = await startIdp();
  open.push(idp);
  const store = Store.migrated(':memory:');
  let t = Date.now();
  const cfg: IdentityConfig = { issuer: new URL(issuerOverride ?? idp.issuer), clientId: idp.clientId, clientSecret: idp.clientSecret,
    redirectUri: new URL('https://api.test/v1/auth/callback'), appOrigin: APP, mfaAmr: 'mfa' };
  const sessions = new Sessions(store.database, () => t);
  const app = createApp({ store, origins: [APP], identity: { cfg, oidc: new Oidc(cfg), sessions }, now: () => new Date(t) });
  const db = store.database;

  /** A browser: its own cookie jar for the API host. */
  const browser = () => {
    const jar = new Map<string, string>();
    const req = async (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) => {
      t = Math.max(t, Date.now());
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await app.request(`https://api.test${path}`, { ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...init.headers } });
      for (const line of res.headers.getSetCookie()) {
        const [pair = ''] = line.split(';');
        const i = pair.indexOf('='), name = pair.slice(0, i), value = pair.slice(i + 1);
        if (!value || /max-age=0/i.test(line)) jar.delete(name); else jar.set(name, value);
      }
      return res;
    };
    /** The whole round trip: login at the API → provider → callback at the API. Returns the callback response. */
    const signIn = async (who: Partial<NextSignIn> = {}, query = '') => {
      idp.next = { sub: 'user-1', amr: ['pwd', 'mfa'], ...who };
      const start = await req(`/v1/auth/login${query}`);
      if (start.status !== 302) return start;
      const atIdp = await fetch(start.headers.get('location')!, { redirect: 'manual' });
      const cb = new URL(atIdp.headers.get('location')!);
      return req(`${cb.pathname}${cb.search}`);
    };
    const session = (origin = APP) => req('/v1/session', { headers: { Origin: origin } });
    const post = async (path: string, csrf?: string, origin: string | null = APP) =>
      req(path, { method: 'POST', headers: { ...(origin ? { Origin: origin } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) } });
    return { jar, req, signIn, session, post };
  };
  return { idp, app, db, sessions, browser, tick: (ms: number) => { t += ms; }, at: () => t };
}

const location = (r: Response) => new URL(r.headers.get('location')!);

describe('configuration and the server flag', () => {
  it('off by default: no flag, no sign-in routes; with the flag an incomplete or unsafe configuration is refused', async () => {
    expect(identityConfig({})).toBeNull();
    const app = createApp({ store: Store.migrated(':memory:'), origins: [APP] });
    for (const p of ['/v1/session', '/v1/auth/login', '/v1/auth/callback']) expect((await app.request(p)).status).toBe(404);
    const ok = { CLINIC_IDENTITY_V2: 'on', OIDC_ISSUER: 'https://tenant.eu.auth0.com/', OIDC_CLIENT_ID: 'c', OIDC_CLIENT_SECRET: 's',
      OIDC_REDIRECT_URI: 'https://api.beyondthesignal.to/v1/auth/callback', APP_ORIGIN: 'https://protocol.beyondthesignal.to' };
    expect(identityConfig(ok)).toMatchObject({ appOrigin: 'https://protocol.beyondthesignal.to', mfaAmr: 'mfa' });
    for (const bad of [{ OIDC_ISSUER: 'http://tenant.example' }, { OIDC_CLIENT_SECRET: '' }, { OIDC_REDIRECT_URI: 'https://api.x/callback' },
      { APP_ORIGIN: 'https://protocol.beyondthesignal.to/app' }, { OIDC_ISSUER: 'https://user:pw@tenant.example' }]) {
      expect(() => identityConfig({ ...ok, ...bad })).toThrow(IdentityConfigError);
    }
  });
});

describe('sign-in', () => {
  it('Authorization Code + PKCE S256 with state and nonce; secrets stay on the server; Secure/HttpOnly/Lax __Host- cookies', async () => {
    const r = await rig();
    const b = r.browser();
    const start = await b.req('/v1/auth/login?return=/plan');
    expect(start.status).toBe(302);
    const to = location(start);
    expect(to.origin).toBe(r.idp.issuer);
    expect(Object.fromEntries(to.searchParams)).toMatchObject({ response_type: 'code', scope: 'openid email', code_challenge_method: 'S256',
      redirect_uri: 'https://api.test/v1/auth/callback', client_id: r.idp.clientId });
    for (const k of ['state', 'nonce', 'code_challenge']) expect(to.searchParams.get(k)!.length).toBeGreaterThanOrEqual(43);
    expect(to.searchParams.has('max_age')).toBe(false);
    const attemptCookie = start.headers.getSetCookie().find((c) => c.startsWith('__Host-plogin='))!;
    expect(attemptCookie).toMatch(/HttpOnly/); expect(attemptCookie).toMatch(/Secure/); expect(attemptCookie).toMatch(/SameSite=Lax/);
    expect(attemptCookie).toMatch(/Path=\//); expect(attemptCookie).not.toMatch(/Domain=/i);
    const stored = JSON.stringify(r.db.prepare('SELECT * FROM login_attempts').all());
    expect(stored).not.toContain(to.searchParams.get('state')!); // only its hash
    expect(stored).not.toContain(b.jar.get('__Host-plogin')!);

    const atIdp = await fetch(to, { redirect: 'manual' });
    const cb = new URL(atIdp.headers.get('location')!);
    const done = await b.req(`${cb.pathname}${cb.search}`);
    expect(done.status).toBe(303);
    expect(location(done).href).toBe(`${APP}/plan`);
    const sessionCookie = done.headers.getSetCookie().find((c) => c.startsWith('__Host-psess='))!;
    for (const flag of [/HttpOnly/, /Secure/, /SameSite=Lax/, /Path=\//]) expect(sessionCookie).toMatch(flag);
    expect(sessionCookie).not.toMatch(/Domain=/i);
    expect(b.jar.has('__Host-plogin')).toBe(false);
    expect(JSON.stringify(r.db.prepare('SELECT * FROM sessions').all())).not.toContain(b.jar.get('__Host-psess')!);

    const me = await b.session();
    expect(me.status).toBe(200);
    expect(me.headers.get('access-control-allow-origin')).toBe(APP);
    expect(me.headers.get('access-control-allow-credentials')).toBe('true');
    expect(me.headers.get('cache-control')).toBe('no-store');
    const body = await me.json() as Record<string, any>;
    expect(body).toMatchObject({ auth: { mfa: true, recent: true }, contexts: [] });
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(body)).not.toMatch(/user-1|id_token|access_token/);
  });

  it('identity is exactly (issuer, subject): the same subject returns, another subject with the same email is another account', async () => {
    const r = await rig();
    const a = r.browser(), b = r.browser(), c = r.browser();
    await a.signIn({ sub: 'alice', email: 'shared@example.com' });
    await b.signIn({ sub: 'alice' });
    await c.signIn({ sub: 'mallory', email: 'shared@example.com' });
    const id = async (x: typeof a) => ((await (await x.session()).json()) as { account: { id: string } }).account.id;
    expect(await id(a)).toBe(await id(b));
    expect(await id(c)).not.toBe(await id(a));
    expect(r.db.prepare('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 2 });
    expect(r.db.prepare('SELECT COUNT(*) AS n FROM organization_memberships').get()).toEqual({ n: 0 }); // a sign-in grants no clinic
  });

  it('a disabled account cannot sign in, and its live sessions stop at the next request', async () => {
    const r = await rig();
    const before = r.browser();
    await before.signIn({ sub: 'bob' });
    r.db.prepare("UPDATE accounts SET status = 'disabled'").run();
    expect((await before.session()).status).toBe(401);
    const again = r.browser();
    const res = await again.signIn({ sub: 'bob' });
    expect(location(res).searchParams.get('login')).toBe('disabled');
    expect(again.jar.has('__Host-psess')).toBe(false);
  });

  it('a provisional (pending_link) account is never reachable by OIDC — linking is ACCESS-04', async () => {
    const r = await rig();
    r.db.prepare("INSERT INTO accounts (id, status, created_at) VALUES ('legacy-1', 'pending_link', 1)").run();
    r.db.prepare('INSERT INTO external_identities (issuer, subject, account_id, created_at) VALUES (?, ?, ?, 1)').run(r.idp.issuer, 'carol', 'legacy-1');
    const b = r.browser();
    expect(location(await b.signIn({ sub: 'carol' })).searchParams.get('login')).toBe('not_linked');
    expect(b.jar.has('__Host-psess')).toBe(false);
  });

  it('a new session id after every sign-in: a session already in the browser is revoked, not reused', async () => {
    const r = await rig();
    const b = r.browser();
    await b.signIn({ sub: 'dave' });
    const first = b.jar.get('__Host-psess')!;
    await b.signIn({ sub: 'erin' });
    expect(b.jar.get('__Host-psess')).not.toBe(first);
    const old = r.browser(); old.jar.set('__Host-psess', first);
    expect((await old.session()).status).toBe(401);
  });

  it('without MFA evidence the session exists but is not fit for clinical work', async () => {
    const r = await rig();
    const b = r.browser();
    await b.signIn({ sub: 'frank', amr: ['pwd'] });
    expect(((await (await b.session()).json()) as { auth: { mfa: boolean } }).auth.mfa).toBe(false);
    const s = r.sessions.authenticate(b.jar.get('__Host-psess'))!;
    expect(clinicalAccess(s)).toBe('mfa_required');
    await b.signIn({ sub: 'frank', amr: undefined });
    expect(clinicalAccess(r.sessions.authenticate(b.jar.get('__Host-psess'))!)).toBe('mfa_required');
  });

  it('only a path on the app is accepted as the return address — never another host', async () => {
    const r = await rig();
    for (const ret of ['//evil.example/x', 'https://evil.example/', '/\\evil', '/\\/evil', 'javascript:alert(1)']) {
      const b = r.browser();
      expect(location(await b.signIn({}, `?return=${encodeURIComponent(ret)}`)).href, ret).toBe(`${APP}/`);
    }
    const encoded = r.browser(); // encoded backslashes stay an ordinary path on the app
    expect(location(await encoded.signIn({}, `?return=${encodeURIComponent('/%5C%5Cevil')}`)).origin).toBe(APP);
  });
});

describe('the callback refuses', () => {
  it('a callback without this browser\'s attempt, with another attempt\'s state, a replay, or after ten minutes', async () => {
    const r = await rig();
    // no attempt cookie: another browser opens the callback
    const a = r.browser();
    const start = await a.req('/v1/auth/login');
    const cb = new URL((await fetch(start.headers.get('location')!, { redirect: 'manual' })).headers.get('location')!);
    const stranger = r.browser();
    expect(location(await stranger.req(`${cb.pathname}${cb.search}`)).searchParams.get('login')).toBe('retry');
    expect(stranger.jar.has('__Host-psess')).toBe(false);

    // the browser's own attempt, but the state of a different attempt
    const b = r.browser();
    await b.req('/v1/auth/login');
    const other = r.browser();
    const os = await other.req('/v1/auth/login');
    const ocb = new URL((await fetch(os.headers.get('location')!, { redirect: 'manual' })).headers.get('location')!);
    expect(location(await b.req(`${ocb.pathname}${ocb.search}`)).searchParams.get('login')).toBe('retry');
    expect(b.jar.has('__Host-psess')).toBe(false);

    // replaying a used callback with the same cookie
    const c = r.browser();
    const cs = await c.req('/v1/auth/login');
    const ccb = new URL((await fetch(cs.headers.get('location')!, { redirect: 'manual' })).headers.get('location')!);
    const attempt = c.jar.get('__Host-plogin')!;
    expect((await c.req(`${ccb.pathname}${ccb.search}`)).status).toBe(303);
    const replay = r.browser(); replay.jar.set('__Host-plogin', attempt);
    expect(location(await replay.req(`${ccb.pathname}${ccb.search}`)).searchParams.get('login')).toBe('retry');
    expect(replay.jar.has('__Host-psess')).toBe(false);

    // expired attempt
    const d = r.browser();
    const ds = await d.req('/v1/auth/login');
    const dcb = new URL((await fetch(ds.headers.get('location')!, { redirect: 'manual' })).headers.get('location')!);
    r.tick(10 * 60_000 + 1);
    expect(location(await d.req(`${dcb.pathname}${dcb.search}`)).searchParams.get('login')).toBe('retry');
    expect(d.jar.has('__Host-psess')).toBe(false);
    const results = (r.db.prepare("SELECT result FROM auth_audit WHERE action = 'callback'").all() as { result: string }[]).map((x) => x.result);
    expect(results).toEqual(['attempt_missing', 'attempt_mismatch', 'attempt_used', 'attempt_expired']);
  });

  for (const wrong of ['nonce', 'iss', 'aud', 'expired', 'signature'] as const) {
    it(`an ID token with a wrong ${wrong}: no account, no session`, async () => {
      const r = await rig();
      const b = r.browser();
      const res = await b.signIn({ sub: `w-${wrong}`, wrong });
      expect(location(res).searchParams.get('login')).toBe('retry');
      expect(b.jar.has('__Host-psess')).toBe(false);
      expect(r.db.prepare('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 0 });
      expect(r.db.prepare("SELECT result FROM auth_audit WHERE action = 'callback'").get()).toEqual({ result: 'invalid_response' });
    });
  }

  it('a cancelled sign-in at the provider and an unreachable provider end without a session', async () => {
    const r = await rig();
    const b = r.browser();
    expect(location(await b.signIn({ deny: true })).searchParams.get('login')).toBe('cancelled');
    expect(b.jar.has('__Host-psess')).toBe(false);
    const down = await rig('http://127.0.0.1:1');
    const c = down.browser();
    const res = await c.req('/v1/auth/login');
    expect(location(res).searchParams.get('login')).toBe('idp_unavailable');
    expect(c.jar.has('__Host-plogin')).toBe(false);
  });

  it('the audit holds categories only — never codes, states, tokens or cookies', async () => {
    const r = await rig();
    const b = r.browser();
    const start = await b.req('/v1/auth/login');
    const to = location(start);
    const cb = new URL((await fetch(to, { redirect: 'manual' })).headers.get('location')!);
    await b.req(`${cb.pathname}${cb.search}`);
    const audit = JSON.stringify(r.db.prepare('SELECT * FROM auth_audit').all());
    for (const secret of [cb.searchParams.get('code')!, to.searchParams.get('state')!, to.searchParams.get('nonce')!, b.jar.get('__Host-psess')!]) {
      expect(audit).not.toContain(secret);
    }
  });
});

describe('sessions', () => {
  it('idle 30 minutes ends a session; activity keeps it only until the 12-hour absolute end', async () => {
    const r = await rig();
    const idle = r.browser();
    await idle.signIn({ sub: 'gina' });
    r.tick(IDLE_MS + 1);
    expect((await idle.session()).status).toBe(401);

    const busy = r.browser();
    await busy.signIn({ sub: 'hank' });
    const end = r.at() + ABSOLUTE_MS;
    while (r.at() + 20 * 60_000 < end) { r.tick(20 * 60_000); expect((await busy.session()).status).toBe(200); }
    r.tick(end - r.at());
    expect((await busy.session()).status).toBe(401);
  });

  it('logout needs the exact Origin and the CSRF token; it revokes this session only and clears the cookie', async () => {
    const r = await rig();
    const b = r.browser(), other = r.browser();
    await b.signIn({ sub: 'ivy' });
    await other.signIn({ sub: 'ivy' });
    const { csrfToken } = await (await b.session()).json() as { csrfToken: string };
    expect((await b.post('/v1/session/logout', csrfToken, null)).status).toBe(403);
    expect((await b.post('/v1/session/logout', csrfToken, 'https://evil.example')).status).toBe(403);
    expect((await b.post('/v1/session/logout', 'x'.repeat(43))).status).toBe(403);
    expect((await b.post('/v1/session/logout')).status).toBe(403);
    expect((await b.session()).status).toBe(200); // none of those changed anything
    const out = await b.post('/v1/session/logout', csrfToken);
    expect(out.status).toBe(200);
    expect(b.jar.has('__Host-psess')).toBe(false);
    const stale = r.browser(); stale.jar.set('__Host-psess', 'whatever');
    expect((await stale.post('/v1/session/logout')).status).toBe(200); // nothing to revoke
    expect((await other.session()).status).toBe(200);
  });

  it('revoke-all ends every session of the account, and only of that account', async () => {
    const r = await rig();
    const a1 = r.browser(), a2 = r.browser(), z = r.browser();
    await a1.signIn({ sub: 'jack' }); await a2.signIn({ sub: 'jack' }); await z.signIn({ sub: 'zoe' });
    const { csrfToken } = await (await a1.session()).json() as { csrfToken: string };
    expect((await a1.post('/v1/sessions/revoke-all')).status).toBe(403);
    const res = await a1.post('/v1/sessions/revoke-all', csrfToken);
    expect(await res.json()).toEqual({ ok: true, revoked: 2 });
    expect((await a1.session()).status).toBe(401);
    expect((await a2.session()).status).toBe(401);
    expect((await z.session()).status).toBe(200);
    expect((await r.browser().post('/v1/sessions/revoke-all', csrfToken)).status).toBe(401);
  });

  it('credentials are offered to the app origin only, and only on session routes', async () => {
    const r = await rig();
    const b = r.browser();
    await b.signIn({ sub: 'kim' });
    const foreign = await b.session('https://evil.example');
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await b.req('/v1/sessions/revoke-all', { method: 'OPTIONS', headers: { Origin: APP, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-csrf-token' } });
    expect(pre.headers.get('access-control-allow-origin')).toBe(APP);
    expect(pre.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-csrf-token');
    const general = await b.req('/health', { headers: { Origin: APP } });
    expect(general.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('housekeeping removes spent attempts and long-ended sessions', async () => {
    const r = await rig();
    const b = r.browser();
    await b.signIn({ sub: 'leo' });
    await r.browser().req('/v1/auth/login'); // abandoned
    r.tick(8 * 86_400_000);
    r.sessions.housekeeping();
    expect(r.db.prepare('SELECT (SELECT COUNT(*) FROM login_attempts) + (SELECT COUNT(*) FROM sessions) AS n').get()).toEqual({ n: 0 });
  });
});

describe('step-up (fresh authentication for sensitive operations)', () => {
  it('asks the provider for max_age=600 and prompt=login, replaces the session, keeps its absolute end', async () => {
    const r = await rig();
    const b = r.browser();
    // a remembered provider session: the person last authenticated 15 minutes ago
    await b.signIn({ sub: 'mia', authTime: Math.floor(Date.now() / 1000) - 15 * 60 });
    const before = b.jar.get('__Host-psess')!;
    const { auth } = await (await b.session()).json() as { auth: { expiresAt: number; recent: boolean } };
    expect(auth.recent).toBe(false);
    r.tick(60_000);
    const res = await b.signIn({ sub: 'mia', authTime: Math.floor(Date.now() / 1000) }, '?purpose=step_up&return=/staff');
    const asked = r.idp.authorizations.at(-1)!;
    expect(asked.get('max_age')).toBe('600');
    expect(asked.get('prompt')).toBe('login');
    expect(location(res).href).toBe(`${APP}/staff`);
    expect(b.jar.get('__Host-psess')).not.toBe(before);
    const now = await (await b.session()).json() as { auth: { recent: boolean; expiresAt: number } };
    expect(now.auth.recent).toBe(true);
    expect(now.auth.expiresAt).toBe(auth.expiresAt);
    const old = r.browser(); old.jar.set('__Host-psess', before);
    expect((await old.session()).status).toBe(401);
  });

  it('a step-up as a different person changes nothing; an authentication older than max_age is rejected', async () => {
    const r = await rig();
    const b = r.browser();
    await b.signIn({ sub: 'nina', authTime: Math.floor(Date.now() / 1000) - 15 * 60 });
    const before = b.jar.get('__Host-psess')!;
    const swap = await b.signIn({ sub: 'oscar' }, '?purpose=step_up');
    expect(location(swap).searchParams.get('login')).toBe('account_mismatch');
    expect(b.jar.get('__Host-psess')).toBe(before);
    const stale = await b.signIn({ sub: 'nina', authTime: Math.floor(Date.now() / 1000) - 700 }, '?purpose=step_up');
    expect(location(stale).searchParams.get('login')).toBe('retry');
    expect(b.jar.get('__Host-psess')).toBe(before);
    expect(((await (await b.session()).json()) as { auth: { recent: boolean } }).auth.recent).toBe(false);
  });

  it('a step-up needs a live session in the same browser', async () => {
    const r = await rig();
    const b = r.browser();
    const res = await b.req('/v1/auth/login?purpose=step_up');
    expect(location(res).searchParams.get('login')).toBe('no_session');
    expect(b.jar.has('__Host-plogin')).toBe(false);
  });
});

describe('startup', () => {
  it('with the flag on and an incomplete configuration the API stops before it serves', async () => {
    const { spawnSync } = await import('node:child_process');
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'protocol-idcfg-'));
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/main.ts'], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, DB_PATH: join(dir, 'db.sqlite'), BACKUP_DIR: dir, PORT: '0', CLINIC_IDENTITY_V2: 'on', OIDC_ISSUER: 'https://tenant.example/' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/identity configuration refused: OIDC_REDIRECT_URI is required/);
    expect(r.stdout).not.toMatch(/protocol-api on/);
  }, 30_000);
});


describe('verified contact evidence for invitations', () => {
  for (const emailVerified of [true, false, 'true'] as const) it(`uses only a signed boolean email_verified: ${emailVerified}`, async () => {
    const r = await rig(), b = r.browser();
    expect((await b.signIn({ email: 'Recipient@EXAMPLE.invalid', emailVerified })).status).toBe(303);
    expect(r.db.prepare('SELECT verified_email FROM sessions ORDER BY created_at DESC LIMIT 1').get()?.verified_email).toBe(emailVerified === true ? 'Recipient@example.invalid' : null);
    expect(JSON.stringify(await (await b.session()).json())).not.toContain('Recipient@');
  });
});
