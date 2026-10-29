import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context, Hono } from 'hono';
import { IdentityError } from './errors.ts';
import { Sessions, secret, digest, ABSOLUTE_MS, type Session } from './sessions.ts';
import { publicOrigin, type Provider } from './oidc.ts';
import { DatabaseBusy, isBusy } from '../db/tx.ts';

export interface Identity { sessions: Sessions; provider: Provider; origin: string }
export const names = (origin: string) => ({ session: origin.startsWith('https:') ? '__Host-protocol-session' : 'protocol-dev-session',
  attempt: origin.startsWith('https:') ? '__Host-protocol-login' : 'protocol-dev-login' });
export const identityStatus = (e: IdentityError): 400 | 401 | 403 | 503 => e.code === 'unauthorized' ? 401
  : ['forbidden', 'mfa_required', 'step_up_required', 'context_required'].includes(e.code) ? 403 : e.code === 'identity_unavailable' ? 503 : 400;

export function sessionToken(c: Context, identity: Identity): string | undefined {
  const name = names(identity.origin).session, parsed = getCookie(c, name);
  if (parsed === undefined && (c.req.header('Cookie') ?? '').split(';').some(p => p.trimStart().startsWith(name + '='))) throw new IdentityError('unauthorized');
  return parsed;
}
export function safeMutation(c: Context, identity: Identity, session: Session): void {
  identity.sessions.csrf(session, c.req.header('X-CSRF-Token'), c.req.header('Origin'), identity.origin);
}

export function mountIdentity(app: Hono, identity: Identity | undefined, allow: (c: Context, bucket: string, n: number) => boolean): void {
  const run = (bucket: string, n: number, f: (c: Context, i: Identity) => Promise<Response> | Response) => async (c: Context): Promise<Response> => {
    c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer');
    try {
      if (!identity) throw new IdentityError('identity_unavailable');
      if (!allow(c, bucket, n)) return c.json({ error: 'too_many' }, 429);
      return await f(c, identity);
    } catch (e) {
      if (e instanceof IdentityError) {
        if (identity && (bucket === 'callback' || e.code === 'forbidden')) {
          try {
            const token = sessionToken(c, identity);
            identity.sessions.denied(bucket === 'callback' ? 'login_failed' : 'access_denied', token ? digest(token) : undefined);
          } catch { return c.json({ error: 'identity_unavailable' }, 503); }
        }
        if (bucket === 'callback' && identity && c.req.header('Accept')?.includes('text/html')) {
          const message = e.code === 'mfa_required' ? 'Для кабінету клініки потрібен вхід із другим фактором.' : 'Спробу входу не підтверджено. Почніть нову спробу.';
          c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
          return c.html(`<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Вхід не підтверджено</title><style>body{font:18px system-ui;max-width:36rem;padding:2rem;margin:auto;line-height:1.5}a{display:inline-block;padding:1rem 0}@media(prefers-color-scheme:dark){body{background:#151a17;color:#eee}a{color:#9ce4b8}}</style><h1>Не вдалося увійти</h1><p>${message}</p><p>Якщо помилка повториться, зверніться до адміністратора клініки.</p><a href="${identity.origin}/#/clinic">Повернутися до входу</a></html>`, identityStatus(e));
        }
        return c.json({ error: e.code }, identityStatus(e));
      }
      if (e instanceof DatabaseBusy || isBusy(e)) { c.header('Retry-After', '1'); return c.json({ error: 'database_busy' }, 503); }
      // Never expose provider response bodies, codes, login URLs or tokens to logs/clients.
      return c.json({ error: 'identity_unavailable' }, 503);
    }
  };
  const authenticate = (c: Context, i: Identity) => i.sessions.authenticate(sessionToken(c, i));
  const cookies = (i: Identity) => ({ httpOnly: true, secure: i.origin.startsWith('https:'), sameSite: 'Lax' as const, path: '/' });
  app.get('/v1/identity/config', (c) => { c.header('Cache-Control', 'no-store'); return c.json({ enabled: !!identity, topology: 'same-origin-bff' }); });
  app.get('/v1/identity/login', run('login', 20, async (c, i) => {
    const stepUp = c.req.query('step_up') === '1';
    let prior: Session | undefined;
    try { prior = authenticate(c, i); } catch (e) { if (!(e instanceof IdentityError) || stepUp) throw e; }
    if (stepUp && !prior) throw new IdentityError('unauthorized');
    const nonce = secret(), verifier = secret(), attempt = i.sessions.begin(nonce, verifier, prior);
    const redirect = await i.provider.authorization(attempt.state, nonce, verifier, stepUp);
    setCookie(c, names(i.origin).attempt, attempt.browser, { ...cookies(i), maxAge: 300 });
    return c.redirect(redirect, 302);
  }));
  app.get('/v1/identity/callback', run('callback', 60, async (c, i) => {
    const url = new URL('/v1/identity/callback', publicOrigin(i.origin)); url.search = new URL(c.req.url).search;
    if (url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1) throw new IdentityError('invalid_login');
    const state = url.searchParams.get('state')!, browser = getCookie(c, names(i.origin).attempt) ?? '';
    const attempt = i.sessions.claim(state, browser);
    deleteCookie(c, names(i.origin).attempt, cookies(i));
    const verified = await i.provider.exchange(url, state, attempt);
    const established = i.sessions.establish(verified, attempt.prior_session_hash);
    setCookie(c, names(i.origin).session, established.token, { ...cookies(i), maxAge: ABSOLUTE_MS / 1000 });
    return c.redirect(`${i.origin}/#/clinic`, 302);
  }));
  app.get('/v1/identity/logged-out', (c) => {
    c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer');
    return identity ? c.redirect(`${identity.origin}/#/clinic`, 302) : c.json({ error: 'identity_unavailable' }, 503);
  });
  app.get('/v1/session', run('session', 1200, (c, i) => {
    const s = authenticate(c, i);
    return c.json({ accountId: s.account_id, csrfToken: s.csrf_secret, mfa: s.mfa === 1,
      authTime: s.auth_time, contexts: i.sessions.contexts(s.account_id) });
  }));
  for (const [path, all] of [['/v1/session/logout', false], ['/v1/sessions/revoke-all', true]] as const) {
    app.post(path, run('session', 1200, (c, i) => {
      const s = authenticate(c, i); safeMutation(c, i, s); const logoutUrl = i.provider.logoutURL(); i.sessions.revoke(s.id_hash, all);
      deleteCookie(c, names(i.origin).session, cookies(i));
      return c.json({ ok: true, logoutUrl });
    }));
  }
}
