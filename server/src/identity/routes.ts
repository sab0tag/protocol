import type { Context, Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { IdentityError } from './errors.ts';
import { cors } from 'hono/cors';
import * as client from 'openid-client';
import { DatabaseBusy, isBusy } from '../db/tx.ts';
import type { IdentityConfig } from './config.ts';
import { IdpRejected, IdpUnavailable, type Oidc } from './oidc.ts';
import { ATTEMPT_MS, isRecent, type Session, type Sessions } from './sessions.ts';

/** `__Host-` cookies: Secure, Path=/, no Domain — they belong to the API host alone (ADR 0001, same-site API). */
const SESSION = 'psess', ATTEMPT = 'plogin';
const RETURN = /^\/(?!\/)[\x21-\x7e]{0,500}$/; // a path on the app, never another host ("//evil")

export interface Identity { cfg: IdentityConfig; oidc: Oidc; sessions: Sessions }
export const isIdentityPath = (path: string) => path.startsWith('/v1/auth/') || path === '/v1/session' || path.startsWith('/v1/session/') || path.startsWith('/v1/sessions/');

/**
 * Sign-in through the API (BFF) and the session API (ACCESS-03). Mounted only with CLINIC_IDENTITY_V2=on.
 * - /v1/auth/login and /v1/auth/callback are top-level navigations; the browser never sees a provider token.
 * - /v1/session* are called by the app with credentials: CORS allows exactly `appOrigin`, and every change needs the
 *   exact Origin plus the session's CSRF token in `X-CSRF-Token` (a custom header also forces a preflight).
 * - Every protected request re-reads the session; there is no fallback that widens access when a check fails.
 */
export function mountIdentity(app: Hono, id: Identity, o: { allow: (c: Context, scope: string, perDay: number) => boolean; now: () => number }): void {
  const { cfg, oidc, sessions } = id;
  const credentialed = cors({ origin: (origin) => (origin === cfg.appOrigin ? origin : null), credentials: true,
    allowMethods: ['GET', 'POST'], allowHeaders: ['Content-Type', 'X-CSRF-Token'], maxAge: 600 });
  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (isIdentityPath(path)) { c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer'); }
    if (path === '/v1/auth/config' || path === '/v1/session' || path.startsWith('/v1/session/') || path.startsWith('/v1/sessions/')) return credentialed(c, next);
    return next();
  });

  const back = (path: string, query?: Record<string, string>) => {
    const u = new URL(path, cfg.appOrigin);
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
    return u.href;
  };
  const failed = (c: Context, reason: string) => c.redirect(back('/', { login: reason }), 303);
  const setSession = (c: Context, token: string, expiresAt: number) => setCookie(c, SESSION, token, {
    prefix: 'host', httpOnly: true, sameSite: 'Lax', path: '/', maxAge: Math.max(1, Math.floor((expiresAt - o.now()) / 1000)) });
  const current = (c: Context): Session | null => sessions.authenticate(getCookie(c, SESSION, 'host'));
  /** Rate limit; a busy database while counting is a retryable refusal, never a 500. */
  const limited = (c: Context, scope: string, perDay: number): Response | null => {
    try { return o.allow(c, scope, perDay) ? null : c.json({ error: 'too_many' }, 429); } catch (e) {
      if (!isBusy(e)) throw e;
      c.header('Retry-After', '1'); return c.json({ error: 'database_busy' }, 503);
    }
  };
  const busy = (c: Context, e: unknown): Response => {
    if (e instanceof DatabaseBusy || isBusy(e)) { c.header('Retry-After', '1'); return c.json({ error: 'database_busy' }, 503); }
    throw e;
  };
  /** A change from the app: exact Origin, a live session and its CSRF token. */
  const mutation = (c: Context, needSession: boolean): Session | null | Response => {
    if (c.req.header('Origin') !== cfg.appOrigin) return c.json({ error: 'forbidden_origin' }, 403);
    const s = current(c);
    if (!s) return needSession ? c.json({ error: 'unauthenticated' }, 401) : null;
    if (c.req.header('X-CSRF-Token') !== s.csrf) return c.json({ error: 'csrf' }, 403);
    return s;
  };

  app.get('/v1/auth/config', c => c.json({ enabled: true }));

  app.get('/v1/auth/login', async (c) => {
    const stop = limited(c, 'auth:login', 200);
    if (stop) return stop;
    const purpose = c.req.query('purpose') === 'step_up' ? 'step_up' : 'login';
    const ret = c.req.query('return') ?? '/';
    // a path on the app only: no scheme, no "//host", no backslash (URL parsers read "\\" as "/"), same origin after parsing
    const returnTo = RETURN.test(ret) && !ret.includes('\\') && new URL(ret, cfg.appOrigin).origin === cfg.appOrigin ? ret : '/';
    let sessionHash: string | null = null;
    if (purpose === 'step_up') {
      const s = current(c);
      if (!s) return failed(c, 'no_session');
      sessionHash = s.hash;
    }
    const state = client.randomState(), nonce = client.randomNonce(), codeVerifier = client.randomPKCECodeVerifier();
    let to: URL;
    try { to = await oidc.authorizationUrl({ state, nonce, codeVerifier, stepUp: purpose === 'step_up' }); } catch (e) {
      if (e instanceof IdpUnavailable) return failed(c, 'idp_unavailable');
      throw e;
    }
    try {
      const attemptId = sessions.startAttempt({ purpose, sessionHash, returnTo, state, nonce, codeVerifier });
      setCookie(c, ATTEMPT, attemptId, { prefix: 'host', httpOnly: true, sameSite: 'Lax', path: '/', maxAge: ATTEMPT_MS / 1000 });
    } catch (e) { return busy(c, e); }
    return c.redirect(to.href, 302);
  });

  app.get('/v1/auth/callback', async (c) => {
    const stop = limited(c, 'auth:callback', 200);
    if (stop) return stop;
    const attemptId = getCookie(c, ATTEMPT, 'host');
    deleteCookie(c, ATTEMPT, { prefix: 'host', path: '/', secure: true });
    let attempt: ReturnType<Sessions['takeAttempt']>;
    try { attempt = sessions.takeAttempt(attemptId, c.req.query('state')); } catch (e) { return busy(c, e); }
    if (typeof attempt === 'string') { sessions.refused('callback', `attempt_${attempt}`); return failed(c, 'retry'); }
    if (c.req.query('error')) { sessions.refused('callback', 'idp_error'); return failed(c, 'cancelled'); }
    const stepUp = attempt.purpose === 'step_up';
    let who;
    try {
      // the URL the provider sent the browser to, rebuilt on the configured callback (never a Host header)
      const callback = new URL(cfg.redirectUri.href);
      callback.search = new URL(c.req.url).search;
      who = await oidc.verify(callback, { state: attempt.state, nonce: attempt.nonce, codeVerifier: attempt.codeVerifier, stepUp });
    } catch (e) {
      if (e instanceof IdpUnavailable) { sessions.refused('callback', 'idp_unavailable'); return failed(c, 'idp_unavailable'); }
      if (e instanceof IdpRejected) { sessions.refused('callback', 'invalid_response'); return failed(c, 'retry'); }
      throw e;
    }
    const mfa = who.amr.includes(cfg.mfaAmr);
    try {
      if (stepUp) {
        // the browser that asked must still hold the session being stepped up
        const s = current(c);
        if (!s || s.hash !== attempt.sessionHash) { sessions.refused('step_up', 'session_changed'); return failed(c, 'no_session'); }
        const r = sessions.stepUp({ sessionHash: s.hash, issuer: who.issuer, subject: who.subject, authTime: who.authTime, mfa });
        if (typeof r === 'string') return failed(c, r);
        setSession(c, r.token, r.session.expiresAt);
      } else {
        const r = sessions.signIn({ issuer: who.issuer, subject: who.subject, authTime: who.authTime, mfa, replacing: sessions.hashOf(getCookie(c, SESSION, 'host')) });
        if (typeof r === 'string') { deleteCookie(c, SESSION, { prefix: 'host', path: '/', secure: true }); return failed(c, r); }
        setSession(c, r.token, r.session.expiresAt);
      }
    } catch (e) { return busy(c, e); }
    return c.redirect(back(attempt.returnTo), 303);
  });

  /** Who is signed in and which clinic contexts exist. No medical data. 401 without a live session. */
  app.get('/v1/session', (c) => {
    const stop = limited(c, 'session:read', 20_000);
    if (stop) return stop;
    let s: Session | null;
    try { s = current(c); } catch (e) { return busy(c, e); }
    if (!s) return c.json({ error: 'unauthenticated' }, 401);
    const t = o.now();
    return c.json({
      account: { id: s.accountId },
      auth: { mfa: s.mfa, authTime: s.authTime || null, recent: isRecent(s, t), expiresAt: s.expiresAt },
      contexts: sessions.contexts(s.accountId),
      csrfToken: s.csrf,
    });
  });

  app.post('/v1/session/logout', (c) => {
    const stop = limited(c, 'session:write', 2_000);
    if (stop) return stop;
    try {
      const s = mutation(c, false);
      if (s instanceof Response) return s;
      if (s) sessions.revoke(s);
    } catch (e) { return busy(c, e); }
    deleteCookie(c, SESSION, { prefix: 'host', path: '/', secure: true });
    return c.json({ ok: true }); // local diaries are never touched by a logout
  });

  app.post('/v1/sessions/revoke-all', (c) => {
    const stop = limited(c, 'session:write', 2_000);
    if (stop) return stop;
    try {
      const s = mutation(c, true);
      if (s instanceof Response) return s;
      if (!s) return c.json({ error: 'unauthenticated' }, 401);
      const revoked = sessions.revokeAll(s.accountId);
      deleteCookie(c, SESSION, { prefix: 'host', path: '/', secure: true });
      return c.json({ ok: true, revoked });
    } catch (e) { return busy(c, e); }
  });
}


/** Shared with the clinic boundary: malformed/expired cookies cannot fall back to bearer authentication. */
export function sessionToken(c: Context, _id: Identity): string | undefined {
  const raw = c.req.header('Cookie') ?? '';
  const parsed = getCookie(c, SESSION, 'host');
  if (/(?:^|;\s*)__Host-psess=/.test(raw) && !parsed) throw new IdentityError('unauthorized');
  return parsed;
}
export function safeMutation(c: Context, id: Identity, s: Session): void {
  if (c.req.header('Origin') !== id.cfg.appOrigin || c.req.header('X-CSRF-Token') !== s.csrf) throw new IdentityError('forbidden');
}
export const identityStatus = (e: IdentityError): 401 | 403 | 503 => e.code === 'unauthorized' ? 401 : e.code === 'identity_unavailable' ? 503 : 403;
