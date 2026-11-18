// Demo stand only: a mock OpenID Connect provider for the staff of «Демо-клініка» (ТЗ «демо клиники», step 1). It signs the
// seeded staff in with a second step (a fixed demo code), so `amr` carries the MFA that D152 requires. It is not a real
// identity provider and refuses to start anywhere but the demo stand (DEMO=1 and an idp.demo.<domain> origin); its discovery
// says what it is (DEMO_MARKER), so an API outside the stand refuses to sign anyone in through it.
//   DEMO=1 DEMO_IDP_ORIGIN=https://idp.demo.example DEMO_IDP_CLIENT_ID=… DEMO_IDP_CLIENT_SECRET=… DEMO_IDP_REDIRECT=https://api.demo.example/v1/auth/callback node src/demo/idp.ts
import { createHash, generateKeyPairSync, randomUUID, sign, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type RequestListener } from 'node:http';
import { DEMO_MARKER, DemoGuardError, isDemoHost } from './guard.ts';

/** The seeded staff (seed.ts links these subjects to the clinic's accounts). */
export const DEMO_STAFF = [
  { subject: 'demo-admin', name: 'Адміністратор (демо)', email: 'admin@demo.invalid' },
  { subject: 'demo-endo', name: 'Ендокринолог (демо)', email: 'endo@demo.invalid' },
  { subject: 'demo-trauma', name: 'Травматолог (демо)', email: 'trauma@demo.invalid' },
] as const;
/** The demo second factor — printed on the sign-in page; it proves nothing, it only walks the same path as a real MFA. */
export const DEMO_CODE = '000000';

export interface IdpConfig { origin: string; clientId: string; clientSecret: string; redirects: string[] }

export function idpConfig(env: Record<string, string | undefined>): IdpConfig {
  if (env.DEMO !== '1') throw new DemoGuardError('the demo identity provider runs only with DEMO=1');
  let origin: URL;
  try { origin = new URL(env.DEMO_IDP_ORIGIN ?? ''); } catch { throw new DemoGuardError('DEMO_IDP_ORIGIN is not a URL'); }
  if (!isDemoHost(origin.hostname)) throw new DemoGuardError('the demo identity provider runs only on idp.demo.<domain>');
  const clientId = env.DEMO_IDP_CLIENT_ID ?? '', clientSecret = env.DEMO_IDP_CLIENT_SECRET ?? '';
  if (clientId.length < 8 || clientSecret.length < 24) throw new DemoGuardError('DEMO_IDP_CLIENT_ID and a DEMO_IDP_CLIENT_SECRET of 24+ characters are required');
  const redirects = (env.DEMO_IDP_REDIRECT ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!redirects.length) throw new DemoGuardError('DEMO_IDP_REDIRECT is required');
  return { origin: origin.origin, clientId, clientSecret, redirects };
}

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const page = (body: string) => `<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Демо-вхід</title><style>body{font:16px/1.5 system-ui;margin:0;background:#f6f4ef;color:#222}main{max-width:26rem;margin:2rem auto;padding:1rem}
.band{background:#fde7c7;padding:.5rem 1rem;text-align:center;font-weight:600}button,input{font:inherit;min-height:44px;width:100%;margin:.25rem 0;border-radius:12px;border:1px solid #bbb;background:#fff}
button{font-weight:600}</style><p class="band">Демо · дані вигадані · тестовий вхід</p><main>${body}</main></html>`;

export function demoIdp(cfg: IdpConfig): RequestListener {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 }), kid = randomUUID();
  const codes = new Map<string, { nonce: string; challenge: string; redirect: string; subject: string; at: number }>();
  const issuer = cfg.origin + '/';
  const form = async (req: IncomingMessage) => { let b = ''; for await (const part of req) { b += part.toString(); if (b.length > 8192) break; } return new URLSearchParams(b); };
  return async (req, res) => {
    const url = new URL(req.url ?? '/', cfg.origin);
    const json = (body: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    const html = (body: string, status = 200) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' }); res.end(page(body)); };
    if (url.pathname === '/.well-known/openid-configuration') return json({ issuer, [DEMO_MARKER]: true,
      authorization_endpoint: cfg.origin + '/authorize', token_endpoint: cfg.origin + '/token', jwks_uri: cfg.origin + '/jwks', end_session_endpoint: cfg.origin + '/logout',
      response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'], code_challenge_methods_supported: ['S256'] });
    if (url.pathname === '/jwks') return json({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] });
    if (url.pathname === '/logout') {
      const target = url.searchParams.get('post_logout_redirect_uri') ?? '';
      if (!cfg.redirects.some((r) => target.startsWith(new URL(r).origin + '/'))) return json({ error: 'invalid_logout' }, 400);
      res.writeHead(302, { Location: target }); return res.end();
    }
    if (url.pathname === '/authorize') {
      const q = url.searchParams;
      if (q.get('client_id') !== cfg.clientId || !cfg.redirects.includes(q.get('redirect_uri') ?? '') || q.get('code_challenge_method') !== 'S256'
        || !q.get('code_challenge') || !q.get('state') || !q.get('nonce')) return html('<p>Неправильний запит на вхід.</p>', 400);
      const keep = ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'nonce'].map((k) => `<input type="hidden" name="${k}" value="${esc(q.get(k) ?? '')}">`).join('');
      if (req.method !== 'POST') {
        return html(`<h1>Вхід до «Демо-клініки»</h1><p>Оберіть, ким увійти. Паролів тут немає: це демо-стенд.</p><form method="post">${keep}
          ${DEMO_STAFF.map((s) => `<button name="as" value="${s.subject}">${esc(s.name)}</button>`).join('')}</form>`);
      }
      const f = await form(req);
      const who = DEMO_STAFF.find((s) => s.subject === f.get('as'));
      if (!who) return html('<p>Невідомий користувач.</p>', 400);
      if (f.get('code') === null) return html(`<h1>Другий крок</h1><p>${esc(who.name)}: введіть код із застосунку. На демо-стенді код — <b>${DEMO_CODE}</b>.</p>
        <form method="post">${keep}<input type="hidden" name="as" value="${who.subject}"><input name="code" inputmode="numeric" autocomplete="one-time-code" aria-label="Код" autofocus><button>Увійти</button></form>`);
      if (!same(f.get('code') ?? '', DEMO_CODE)) return html('<p>Код не підійшов. Поверніться й спробуйте ще раз.</p>', 401);
      const code = randomUUID();
      codes.set(code, { nonce: q.get('nonce')!, challenge: q.get('code_challenge')!, redirect: q.get('redirect_uri')!, subject: who.subject, at: Date.now() });
      const back = new URL(q.get('redirect_uri')!); back.searchParams.set('code', code); back.searchParams.set('state', q.get('state')!);
      res.writeHead(302, { Location: back.href }); return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const p = await form(req), row = codes.get(p.get('code') ?? '');
      codes.delete(p.get('code') ?? '');
      const challenge = createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url');
      if (!row || Date.now() - row.at > 120_000 || !same(p.get('client_id') ?? '', cfg.clientId) || !same(p.get('client_secret') ?? '', cfg.clientSecret)
        || p.get('redirect_uri') !== row.redirect || challenge !== row.challenge) return json({ error: 'invalid_grant' }, 400);
      const who = DEMO_STAFF.find((s) => s.subject === row.subject)!;
      const at = Math.floor(Date.now() / 1000);
      const payload = { iss: issuer, sub: who.subject, aud: cfg.clientId, exp: at + 300, iat: at, auth_time: at, nonce: row.nonce, amr: ['pwd', 'mfa'], email: who.email, email_verified: true };
      const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
      const input = `${enc({ alg: 'RS256', kid })}.${enc(payload)}`;
      return json({ access_token: randomUUID(), token_type: 'Bearer', expires_in: 300, id_token: `${input}.${sign('RSA-SHA256', Buffer.from(input), keys.privateKey).toString('base64url')}` });
    }
    json({ error: 'not_found' }, 404);
  };
}

if (import.meta.main) {
  let cfg: IdpConfig;
  try { cfg = idpConfig(process.env); } catch (e) { console.error(`demo identity provider refused: ${(e as Error).message}`); process.exit(1); }
  const port = Number(process.env.PORT ?? 8090);
  createServer(demoIdp(cfg)).listen(port, () => console.log(`demo identity provider on :${port} for ${cfg.origin}`));
}
