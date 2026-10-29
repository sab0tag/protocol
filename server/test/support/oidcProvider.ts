// A minimal OIDC provider for tests (ACCESS-03): discovery, JWKS, authorize and token with PKCE S256 and a client
// secret, signing real RS256 ID tokens. `next` shapes the next sign-in, including deliberately wrong claims.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

export interface NextSignIn {
  sub: string;
  amr?: string[] | undefined;
  /** seconds; `null` leaves the claim out */
  authTime?: number | null;
  email?: string;
  emailVerified?: boolean | string;
  deny?: boolean;
  wrong?: 'nonce' | 'iss' | 'aud' | 'expired' | 'signature';
}

export interface Idp {
  issuer: string;
  clientId: string;
  clientSecret: string;
  next: NextSignIn;
  authorizations: URLSearchParams[];
  close(): Promise<void>;
}

const b64 = (b: Buffer) => b.toString('base64url');

export async function startIdp(clientId = 'protocol-test', clientSecret = 'test-secret'): Promise<Idp> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const stranger = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { params: URLSearchParams; who: NextSignIn }>();
  let issuer = '';
  const idp: Idp = { issuer: '', clientId, clientSecret, next: { sub: 'user-1', amr: ['pwd', 'mfa'] }, authorizations: [], close: async () => {} };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_post'] });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/authorize') {
      idp.authorizations.push(url.searchParams);
      const back = new URL(url.searchParams.get('redirect_uri')!);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      if (idp.next.deny) back.searchParams.set('error', 'access_denied');
      else {
        const code = b64(randomBytes(24));
        codes.set(code, { params: url.searchParams, who: { ...idp.next } });
        back.searchParams.set('code', code);
      }
      res.writeHead(302, { Location: back.href }); return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      const grant = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? ''); // one use
      if (!grant || form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) return json(400, { error: 'invalid_grant' });
      if (form.get('redirect_uri') !== grant.params.get('redirect_uri')) return json(400, { error: 'invalid_grant' });
      const challenge = b64(createHash('sha256').update(form.get('code_verifier') ?? '').digest());
      if (grant.params.get('code_challenge_method') !== 'S256' || challenge !== grant.params.get('code_challenge')) return json(400, { error: 'invalid_grant' });
      const w = grant.who, now = Math.floor(Date.now() / 1000);
      const claims: Record<string, unknown> = { sub: w.sub, nonce: w.wrong === 'nonce' ? 'other' : grant.params.get('nonce') };
      if (w.amr) claims.amr = w.amr;
      if (w.authTime !== null) claims.auth_time = w.authTime ?? now;
      if (w.email) claims.email = w.email;
      if (w.emailVerified !== undefined) claims.email_verified = w.emailVerified;
      const token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(w.wrong === 'iss' ? `${issuer}/other` : issuer).setAudience(w.wrong === 'aud' ? 'someone-else' : clientId)
        .setIssuedAt(w.wrong === 'expired' ? now - 7200 : now).setExpirationTime(w.wrong === 'expired' ? now - 3600 : now + 300)
        .sign(w.wrong === 'signature' ? stranger.privateKey : privateKey);
      return json(200, { access_token: b64(randomBytes(16)), token_type: 'Bearer', expires_in: 300, id_token: token });
    }
    json(404, { error: 'not_found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  issuer = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  idp.issuer = issuer;
  idp.close = () => new Promise((r) => server.close(() => r()));
  return idp;
}
