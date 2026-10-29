import { createRemoteJWKSet, jwtVerify } from 'jose';
import * as client from 'openid-client';
import type { IdentityConfig } from './config.ts';

/** The identity provider could not be reached or described itself unusably. Nothing was changed; retry later. */
export class IdpUnavailable extends Error {}
/** The callback did not verify: state, PKCE, nonce, issuer, audience, signature, expiry or max_age. */
export class IdpRejected extends Error {}

export interface VerifiedSignIn {
  /** The provider's issuer exactly as discovered; with `subject` it is the only identity key (never email). */
  issuer: string;
  subject: string;
  /** When the person actually authenticated (ms). 0 when the provider did not say — never treated as recent. */
  authTime: number;
  amr: string[];
}

const STEP_UP_MAX_AGE_S = 600; // TZ §4.2: sensitive operations need authentication not older than 10 minutes

/**
 * OIDC Authorization Code + PKCE (S256) as a confidential client of the API (BFF). Tokens never reach the browser:
 * the ID token is verified here once and only subject, auth_time and amr are kept. openid-client checks state, nonce,
 * PKCE, issuer, audience, expiry and — when asked — max_age against auth_time; the signature is verified explicitly
 * against the provider's JWKS (see verifySignature).
 */
export class Oidc {
  private readonly cfg: IdentityConfig;
  private discovered: Promise<client.Configuration> | null = null;
  private keys: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(cfg: IdentityConfig) { this.cfg = cfg; }

  private config(): Promise<client.Configuration> {
    if (!this.discovered) {
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(this.cfg.issuer.hostname);
      this.discovered = client.discovery(this.cfg.issuer, this.cfg.clientId, undefined, client.ClientSecretPost(this.cfg.clientSecret),
        local ? { execute: [client.allowInsecureRequests] } : undefined)
        .catch((e) => { this.discovered = null; throw new IdpUnavailable((e as Error).message); });
    }
    return this.discovered;
  }

  async authorizationUrl(p: { state: string; nonce: string; codeVerifier: string; stepUp: boolean }): Promise<URL> {
    const config = await this.config();
    return client.buildAuthorizationUrl(config, {
      redirect_uri: this.cfg.redirectUri.href,
      scope: 'openid',
      code_challenge: await client.calculatePKCECodeChallenge(p.codeVerifier),
      code_challenge_method: 'S256',
      state: p.state,
      nonce: p.nonce,
      // a fresh authentication, not a remembered provider session
      ...(p.stepUp ? { max_age: String(STEP_UP_MAX_AGE_S), prompt: 'login' } : {}),
    });
  }

  private async verifySignature(config: client.Configuration, idToken: string | undefined): Promise<void> {
    const meta = config.serverMetadata();
    if (!idToken || !meta.jwks_uri) throw new IdpRejected('no id_token or jwks');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(this.cfg.issuer.hostname);
    const jwks = new URL(meta.jwks_uri);
    if (jwks.protocol !== 'https:' && !local) throw new IdpRejected('jwks_uri not https');
    this.keys ??= createRemoteJWKSet(jwks);
    await jwtVerify(idToken, this.keys, { issuer: meta.issuer, audience: this.cfg.clientId, algorithms: ['RS256', 'PS256', 'ES256'], clockTolerance: 30 });
  }

  async verify(callback: URL, checks: { state: string; nonce: string; codeVerifier: string; stepUp: boolean }): Promise<VerifiedSignIn> {
    const config = await this.config();
    let claims: client.IDToken | undefined;
    try {
      const tokens = await client.authorizationCodeGrant(config, callback, {
        pkceCodeVerifier: checks.codeVerifier, expectedState: checks.state, expectedNonce: checks.nonce, idTokenExpected: true,
        ...(checks.stepUp ? { maxAge: STEP_UP_MAX_AGE_S } : {}),
      });
      claims = tokens.claims();
      // openid-client, per OIDC Core 3.1.3.7, may skip the signature of an ID token received straight from the token
      // endpoint. ADR 0001 relies on `amr`/`auth_time` from a cryptographically verified token, so verify it here too.
      await this.verifySignature(config, tokens.id_token);
    } catch (e) {
      if (e instanceof IdpUnavailable) throw e;
      throw new IdpRejected((e as Error).name);
    }
    if (!claims || typeof claims.sub !== 'string' || !claims.sub) throw new IdpRejected('no subject');
    const amr = Array.isArray(claims.amr) ? claims.amr.filter((x): x is string => typeof x === 'string') : [];
    const authTime = typeof claims.auth_time === 'number' ? claims.auth_time * 1000 : 0;
    return { issuer: config.serverMetadata().issuer, subject: claims.sub, authTime, amr };
  }
}
