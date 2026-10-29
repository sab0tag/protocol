/**
 * ACCESS-03 configuration. Sign-in is behind the server flag `CLINIC_IDENTITY_V2=on` and is off by default: without it
 * no /v1/auth or /v1/session route exists. With the flag on, an incomplete or unsafe configuration stops the server
 * rather than starting a half-working login.
 */
export interface IdentityConfig {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  /** The API's own callback, e.g. https://api.beyondthesignal.to/v1/auth/callback (ADR 0001: same-site API). */
  redirectUri: URL;
  /** The exact app origin allowed to call session routes with credentials and to receive the browser after sign-in. */
  appOrigin: string;
  /** The `amr` value that proves a completed MFA challenge (Auth0: `mfa`). */
  mfaAmr: string;
}

export class IdentityConfigError extends Error {}

const local = (u: URL) => u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
const secure = (u: URL) => u.protocol === 'https:' || (u.protocol === 'http:' && local(u));

function url(name: string, value: string | undefined): URL {
  if (!value) throw new IdentityConfigError(`${name} is required when CLINIC_IDENTITY_V2=on`);
  let u: URL;
  try { u = new URL(value); } catch { throw new IdentityConfigError(`${name} is not a URL`); }
  if (!secure(u)) throw new IdentityConfigError(`${name} must be https (http only for localhost)`);
  if (u.username || u.password || u.hash) throw new IdentityConfigError(`${name} must not carry credentials or a fragment`);
  return u;
}

export function identityConfig(env: Record<string, string | undefined>): IdentityConfig | null {
  if (env.CLINIC_IDENTITY_V2 !== 'on') return null;
  const issuer = url('OIDC_ISSUER', env.OIDC_ISSUER);
  const redirectUri = url('OIDC_REDIRECT_URI', env.OIDC_REDIRECT_URI);
  if (redirectUri.pathname !== '/v1/auth/callback' || redirectUri.search) throw new IdentityConfigError('OIDC_REDIRECT_URI must end in /v1/auth/callback without a query');
  const app = url('APP_ORIGIN', env.APP_ORIGIN);
  if (app.pathname !== '/' || app.search) throw new IdentityConfigError('APP_ORIGIN must be an origin, without a path');
  const clientId = env.OIDC_CLIENT_ID ?? '', clientSecret = env.OIDC_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) throw new IdentityConfigError('OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required when CLINIC_IDENTITY_V2=on');
  return { issuer, clientId, clientSecret, redirectUri, appOrigin: app.origin, mfaAmr: env.OIDC_MFA_AMR || 'mfa' };
}
