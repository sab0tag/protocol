// Synthetic issuer only. Production never imports this module or permits an HTTP issuer.
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer, type RequestListener } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';

export interface FakeClaims { subject?: string; amr?: string[]; authOffsetS?: number; nonce?: string; issuer?: string; audience?: string; badSignature?: boolean; alg?: string }
export async function fakeOidc(initial: FakeClaims = {}, tls?: { key: string; cert: string }) {
  let keys = generateKeyPairSync('rsa', { modulusLength: 2048 }), kid = randomUUID();
  let claims = { ...initial };
  const codes = new Map<string, { nonce: string; challenge: string; redirect: string; subject: string }>();
  const clientId = 'synthetic-client', clientSecret = 'synthetic-client-secret';
  let origin = '';
  const handler: RequestListener = async (req, res) => {
    const url = new URL(req.url!, origin);
    const json = (body: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/.well-known/openid-configuration') return json({ issuer: origin + '/',
      end_session_endpoint: origin + '/logout', authorization_endpoint: origin + '/authorize', token_endpoint: origin + '/token', jwks_uri: origin + '/jwks',
      response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'], code_challenge_methods_supported: ['S256'] });
    if (url.pathname === '/logout') {
      const target = url.searchParams.get('post_logout_redirect_uri');
      if (!target || new URL(target).pathname !== '/v1/identity/logged-out') return json({ error: 'invalid_logout' }, 400);
      res.writeHead(302, { Location: target }); return res.end();
    }
    if (url.pathname === '/jwks') return json({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] });
    if (url.pathname === '/authorize') {
      if (!url.searchParams.has('as')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        const hidden = [...url.searchParams].map(([k, v]) => `<input type="hidden" name="${k}" value="${v.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">`).join('');
        return res.end(`<h1>Synthetic identity provider</h1><form>${hidden}<button name="as" value="doctor">Continue as Doctor</button><button name="as" value="admin">Continue as Admin</button><button name="as" value="outsider">Continue as Outsider</button><button name="as" value="invitee">Continue as Invitee</button><button name="as" value="bootstrap">Continue as Bootstrap</button></form>`);
      }
      const code = randomUUID();
      codes.set(code, { nonce: url.searchParams.get('nonce')!, challenge: url.searchParams.get('code_challenge')!, redirect: url.searchParams.get('redirect_uri')!, subject: claims.subject ?? url.searchParams.get('as')! });
      const back = new URL(url.searchParams.get('redirect_uri')!); back.searchParams.set('code', code); back.searchParams.set('state', url.searchParams.get('state')!);
      res.writeHead(302, { Location: back.href }); return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = ''; for await (const part of req) body += part.toString();
      const p = new URLSearchParams(body), row = codes.get(p.get('code')!); codes.delete(p.get('code')!);
      const challenge = createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url');
      if (!row || p.get('client_id') !== clientId || p.get('client_secret') !== clientSecret || p.get('redirect_uri') !== row.redirect || challenge !== row.challenge) return json({ error: 'invalid_grant' }, 400);
      const at = Math.floor(Date.now() / 1000);
      const payload = { iss: claims.issuer ?? origin + '/', sub: row.subject, aud: claims.audience ?? clientId,
        exp: at + 300, iat: at, auth_time: at + (claims.authOffsetS ?? 0), nonce: claims.nonce ?? row.nonce,
        amr: claims.amr ?? ['pwd', 'mfa'], roles: ['admin'], organizationId: 'untrusted-provider-organization', email: 'same-contact@example.invalid', email_verified: true };
      const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
      const input = `${encode({ alg: claims.alg ?? 'RS256', kid })}.${encode(payload)}`;
      const signature = sign('RSA-SHA256', Buffer.from(input), claims.badSignature ? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey : keys.privateKey).toString('base64url');
      return json({ access_token: 'synthetic-access-token-never-store', token_type: 'Bearer', expires_in: 300, id_token: `${input}.${signature}` });
    }
    json({ error: 'not_found' }, 404);
  };
  const server = tls ? createHttpsServer(tls, handler) : createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `${tls ? 'https' : 'http'}://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { issuer: origin + '/', clientId, clientSecret, setClaims: (value: FakeClaims) => { claims = { ...value }; },
    rotate: () => { keys = generateKeyPairSync('rsa', { modulusLength: 2048 }); kid = randomUUID(); },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
