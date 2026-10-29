import * as oidc from 'openid-client';
import { IdentityError } from './errors.ts';
import { FRESH_MS, type Attempt, type VerifiedIdentity } from './sessions.ts';

export interface Provider {
  logoutURL(): string;
  authorization(state: string, nonce: string, verifier: string, stepUp: boolean): Promise<string>;
  exchange(url: URL, state: string, attempt: Attempt): Promise<VerifiedIdentity>;
}
export interface IdentityConfig { issuer: string; clientId: string; clientSecret: string; publicOrigin: string }

export function publicOrigin(value: string): string {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' ||
    (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) throw new Error('invalid identity public origin');
  return u.origin;
}

/** Uses supported OIDC validation, including explicit JWS/JWKS verification. No raw JWT parsing in application code. */
export async function auth0Provider(config: IdentityConfig, options: { loopbackTestIssuer?: boolean } = {}): Promise<Provider> {
  const origin = publicOrigin(config.publicOrigin), issuer = new URL(config.issuer);
  const localTest = options.loopbackTestIssuer === true && issuer.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(issuer.hostname);
  if ((issuer.protocol !== 'https:' && !localTest) || issuer.username || issuer.password || issuer.search || issuer.hash || !config.clientId || !config.clientSecret) throw new Error('invalid OIDC configuration');
  const client = await oidc.discovery(issuer, config.clientId, { client_secret: config.clientSecret,
    id_token_signed_response_alg: 'RS256', [oidc.clockTolerance]: 0 }, undefined,
    { timeout: 10, execute: localTest ? [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks] : [oidc.enableNonRepudiationChecks] });
  const endSession = client.serverMetadata().end_session_endpoint;
  if (!endSession || !(new URL(endSession).protocol === 'https:' || localTest && new URL(endSession).origin === issuer.origin)) throw new Error('secure OIDC logout metadata is required');
  const redirect = `${origin}/v1/identity/callback`;
  return {
    logoutURL: () => oidc.buildEndSessionUrl(client, { client_id: config.clientId, post_logout_redirect_uri: `${origin}/v1/identity/logged-out` }).href,
    async authorization(state, nonce, verifier, stepUp) {
      return oidc.buildAuthorizationUrl(client, { redirect_uri: redirect, scope: 'openid', response_type: 'code', state, nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', max_age: '600',
        acr_values: 'http://schemas.openid.net/pape/policies/2007/06/multi-factor', ...(stepUp ? { prompt: 'login' } : {}) }).href;
    },
    async exchange(url, state, attempt) {
      try {
        const tokens = await oidc.authorizationCodeGrant(client, url, { expectedState: state, expectedNonce: attempt.nonce,
          pkceCodeVerifier: attempt.verifier, idTokenExpected: true, maxAge: 600 });
        const claims = tokens.claims();
        if (!claims || claims.iss !== issuer.href || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 ||
          typeof claims.auth_time !== 'number' || !Number.isSafeInteger(claims.auth_time) || claims.auth_time * 1000 > Date.now() ||
          claims.auth_time * 1000 + FRESH_MS < Date.now()) throw new IdentityError('invalid_login');
        if (!Array.isArray(claims.amr) || !claims.amr.includes('mfa')) throw new IdentityError('mfa_required');
        return { issuer: claims.iss, subject: claims.sub, authTime: claims.auth_time * 1000, mfa: true };
      } catch (e) { if (e instanceof IdentityError) throw e; throw new IdentityError('invalid_login'); }
    },
  };
}

/** No insecure issuer option is available through environment configuration. Test providers are constructed in tests. */
export function configFromEnv(env: Record<string, string | undefined>): IdentityConfig | null {
  if (env.IDENTITY_ENABLED !== 'true') return null;
  const issuer = env.AUTH0_ISSUER, clientId = env.AUTH0_CLIENT_ID, clientSecret = env.AUTH0_CLIENT_SECRET, origin = env.IDENTITY_PUBLIC_ORIGIN;
  if (!issuer || !clientId || !clientSecret || !origin || new URL(issuer).protocol !== 'https:') throw new Error('incomplete secure identity configuration');
  return { issuer, clientId, clientSecret, publicOrigin: publicOrigin(origin) };
}
