# ACCESS-03: sign-in and server sessions

Baseline: main `09898ae` (ACCESS-02, ACCESS-05, ACCESS-07-A, ADR 0001 accepted). Migration `0004_sessions`.
Off by default: nothing changes until `CLINIC_IDENTITY_V2=on` is set on the server.

## Topology (ADR 0001, acceptance item 5)
Decided 2026-10-29: **same-site API**. The app stays on `protocol.beyondthesignal.to`, the API on
`api.beyondthesignal.to`; no proxy.
- Sign-in is a top-level navigation to the API: `GET /v1/auth/login` → provider → `GET /v1/auth/callback` on the API
  → back to the app. The callback URL is the API's own (`OIDC_REDIRECT_URI`).
- Cookies are `__Host-` cookies of the API host: Secure, HttpOnly, `SameSite=Lax`, `Path=/`, no `Domain`. The app
  host never receives them; `*.beyondthesignal.to` is not widened.
- The app calls `/v1/session*` with `credentials: 'include'`. Only those routes answer CORS with credentials, and only
  for exactly `APP_ORIGIN`. All other routes keep the existing non-credentialed CORS.

## Flow
- Authorization Code + PKCE S256, `state`, `nonce`, `scope=openid`, confidential client (`client_secret_post`).
  State, nonce and the PKCE verifier stay in `login_attempts`; the browser holds only a random attempt id in
  `__Host-plogin` (10 minutes, one use). A callback must come with the attempt cookie of the browser that started it
  and its exact state; a replay, another browser, a mismatch or an expired attempt ends without a session.
- The ID token is verified by openid-client (state, nonce, PKCE, issuer, audience, expiry, `max_age`) **and** its
  signature against the provider's JWKS. openid-client alone may skip the signature for tokens taken straight from the
  token endpoint; ADR 0001 relies on `amr`/`auth_time` from a verified token. No provider token is stored or sent to
  the browser; only `sub`, `auth_time` and the MFA evidence are kept.
- Identity is exactly `(issuer, subject)`. Email and names are ignored. An unknown identity gets a new `active`
  Account with **no membership** — it carries no clinical rights. A `pending_link` account (ACCESS-02 placeholder) is
  never reachable by OIDC; linking is ACCESS-04. A disabled account is refused at sign-in and on every request.
- Every sign-in creates a new session id; a session already in that browser is revoked (no fixation).
- `return` must be a path on the app: no scheme, no `//host`, no backslash, same origin after parsing.

## Sessions
- `sessions` stores the SHA-256 of the cookie value, the account, `auth_time`, MFA (`amr` contains `OIDC_MFA_AMR`,
  default `mfa`), a CSRF token, idle and absolute limits: **30 minutes idle, 12 hours absolute**. Every protected
  request re-reads the session and the account: logout, revoke-all or a disabled account take effect at once.
- `GET /v1/session` — account id, `{ mfa, authTime, recent, expiresAt }`, clinic contexts (active memberships with
  their roles — a listing, not authority) and the CSRF token. No medical data. 401 without a live session.
- `POST /v1/session/logout` and `POST /v1/sessions/revoke-all` need the exact `Origin` and `X-CSRF-Token`. Logout
  revokes this session; revoke-all every session of the account. Local diaries are never touched.
- **Step-up**: `GET /v1/auth/login?purpose=step_up` asks the provider for `max_age=600&prompt=login`, requires a live
  session in the same browser and the same account at the callback, replaces the session id and keeps its absolute
  end. `isRecent(session)` (≤ 10 minutes) is the check for sensitive operations.
- `clinicalAccess(session)` returns `mfa_required` without MFA evidence. ACCESS-04 applies it when a session becomes
  a clinic membership subject; this PR adds no clinical route on sessions.
- `auth_audit`: account (when known), action, result category. Never codes, state, nonce, tokens or cookies.
  Housekeeping hourly: spent attempts, sessions ended over 7 days ago, audit past 180 days.
- Rate limits per address and day: login and callback 200, session reads 20 000, session changes 2 000. A busy
  database is `503 database_busy` with `Retry-After: 1`.

## Configuration
`CLINIC_IDENTITY_V2=on`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (secret store, never in source),
`OIDC_REDIRECT_URI=https://api.beyondthesignal.to/v1/auth/callback`, `APP_ORIGIN=https://protocol.beyondthesignal.to`,
optional `OIDC_MFA_AMR`. With the flag on, a missing or non-https value (http only for localhost), a redirect not
ending in `/v1/auth/callback` or an app origin with a path stops the server.

## Not in this PR
Invitations, linking provisional staff accounts, choosing a clinic context and clinic routes on sessions (ACCESS-04);
patient sign-in and profile binding (ACCESS-06); any UI. No Auth0 tenant, credentials or production setting was
created; the flag stays off in production. Before enabling: ADR 0001 acceptance items 2–4 and 6 with a real tenant.

## Tests
`server/test/identity.test.ts` against a local OIDC provider (`test/support/oidcProvider.ts`) that signs real RS256
tokens: PKCE/state/nonce parameters and cookie flags; secrets stored only as hashes; identity by `(issuer, subject)`
not email; disabled and provisional accounts; session id rotation; missing MFA; return-path open-redirect cases;
callback without the attempt cookie, with another attempt's state, replayed and expired; ID tokens with a wrong nonce,
issuer, audience, expiry or **signature**; cancelled sign-in and unreachable provider; audit free of secrets; idle and
absolute expiry; logout and revoke-all with Origin/CSRF; credentialed CORS limited to the app origin and session
routes; housekeeping; step-up parameters, rotation, kept absolute end, another person, stale `auth_time`, no session;
startup refusal with an incomplete configuration.

## Follow-up: ACCESS-04-A

[Clinical session integration](access-04-clinic-sessions.md) applies MFA and live membership roles at clinical service
boundaries, adds clinic context selection and the specialist login UI. Credentialed CORS extends to protected clinic
routes for the exact APP_ORIGIN; anonymous plan redemption remains non-credentialed. Invitations, approved placeholder
linking, role-set administration and per-clinic legacy cutover still remain before real rollout.
