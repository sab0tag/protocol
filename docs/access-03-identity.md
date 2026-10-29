# ACCESS-03: OIDC/BFF sessions and clinical authentication

Base: main `09898ae7b30580f90423554ee0a452ccf21ae47d`. Provider decision: [Auth0 EU ADR](adr/0001-identity-provider.md).
Implementation is disabled by default. No real tenant, paid plan, production route or secret is provisioned here.

## Identity boundary

Use `openid-client` 6.8.8, Authorization Code + S256 PKCE, mandatory random state and nonce. Discovery validates the
configured issuer; `enableNonRepudiationChecks` additionally verifies JWS through JWKS. RS256 is the configured ID
token algorithm. The client checks issuer/audience, nonce/state, code verifier and token validity. Protocol checks
signed `auth_time` (at most 600 seconds old, no future tolerance) and Auth0 `amr` containing `mfa`. Requesting an MFA
challenge is not proof of completion. Provider role/name/email claims never supply Protocol permissions.

Login attempts are usable for five minutes and bound to a separate HttpOnly browser cookie. State and browser
secrets are stored as hashes. A callback atomically claims the attempt before contacting the token endpoint;
replays cannot exchange a second code. Its nonce/verifier are erased from storage on claim. Failed exchanges
require a new login. Provider requests time out after ten seconds. Unknown signing keys fail closed during the
SDK's current 60-second refresh cooldown; keys are refreshed through the supported library, not an unverified JWT.

Only exact `(issuer, subject)` selects an external identity. First login can create an active Account, but creates
no patient binding, clinic, membership or grant. It cannot claim an old staff placeholder by email/name or bearer
secret. Invitation/explicit linking is ACCESS-04; optional patient sign-in/profile binding is ACCESS-06.

## Same-origin topology

The browser calls `/v1/identity/*`, `/v1/session`, `/v1/sessions/*` and cookie-authenticated `/v1/clinic/*` on the app's
origin. The BFF/API serves these routes behind an explicitly configured reverse proxy. The public app origin is a
canonical server setting; request Host/returnTo parameters cannot choose callback or post-logout destinations.
The existing separate API host remains usable by legacy bearer clients. Credentialed CORS is not enabled.

Vite dev/preview proxy supports these paths locally (`PROTOCOL_BFF_TARGET`, default 8080 for dev / 8099 for preview).
Production rewrites are deliberately not added by this PR: configure and verify the same-origin proxy before
enabling real login. An unconfigured static preview does not turn login on. Service-worker navigation fallback
excludes `/v1/`, so it cannot replace callbacks or login redirects with the PWA shell.

## Sessions and authorization

Migration 0004 adds `identity_sessions`, `identity_login_attempts` and minimal `identity_audit`; earlier migrations
remain immutable. The browser receives a random opaque session credential in a host-only `__Host-` cookie with
Secure, HttpOnly, SameSite=Lax, Path=/ and a 12-hour absolute lifetime. Non-Secure `protocol-dev-*` names are allowed
only for explicitly configured HTTP loopback app origins. Production issuer configuration always requires HTTPS;
the loopback HTTP issuer exception exists only in the test factory and is not an environment switch.

The database stores the credential hash, Account ID, CSRF secret, server times, authentication time and MFA result.
It stores no password, provider access/refresh/ID token, email or clinical data. Idle expiry is 30 minutes; legitimate
authenticated requests refresh last-seen, while service checks do not. Cleanup removes expired/consumed attempts
and unusable sessions; audit history remains separate. Clinic/profile responses and identity responses are no-store.

Every cookie mutation requires exact Origin plus the session's CSRF header. Both cookies and Authorization in a
clinical request are rejected; a denied/expired cookie never falls back to bearer auth. Session Actors recheck the
live session, Account, exact membership/organization and current database roles at service boundaries, including
inside write transactions. Sensitive staff mutations also recheck authentication freshness there. Account disable,
membership removal, role changes and revocation take effect at the next operation.

Multiple contexts require an explicit selector. Changing context/logout/unmount aborts requests and unmounts old
clinic content; denied sessions clear it. Identity, CSRF and clinic context stay in tab memory, not browser storage.
Fresh clinic/plan-import routes do not force patient onboarding or mark it complete. Local journals are not deleted
on logout. Client UI visibility is not server authorization.

## HTTP surface

| Route | Behavior |
| --- | --- |
| GET /v1/identity/config | Public enabled status; no credentials |
| GET /v1/identity/login | Browser-bound attempt, provider redirect; `step_up=1` requires the current session |
| GET /v1/identity/callback | One-time validated code exchange, fresh staff MFA, new opaque cookie; fixed clinic destination |
| GET /v1/session | Account, MFA/freshness metadata, CSRF and live clinic contexts; no medical content |
| POST /v1/session/logout | CSRF-protected current-session revocation, cookie removal and RP-Initiated Logout URL |
| POST /v1/sessions/revoke-all | CSRF-protected revocation of all current Protocol sessions for this Account |
| GET /v1/identity/logged-out | Fixed redirect only, no state mutation |

Successful login/rotation/logout/revoke-all are audited atomically. Failed callbacks and session-context denials
record a category/known Account only, never raw attacker fields, provider responses, codes or medical content.
Busy SQLite operations are retryable 503 responses; unavailable identity fails closed. Browser callback failures
have a safe return link; detailed provider failures are not exposed.

Protocol sessions are revoked before redirecting the current browser to the provider's registered logout endpoint.
No ID token is retained for logout. Revoke-all invalidates other Protocol cookies, not every upstream IdP SSO session;
an explicit future login is a new authenticated operation. No federated/global account deletion is performed here.

## Configuration and enablement gates

- `IDENTITY_ENABLED=true` explicitly enables the adapter; otherwise the routes are unavailable and legacy behavior remains.
- `AUTH0_ISSUER`: exact HTTPS issuer of the chosen EU tenant (including canonical trailing slash).
- `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET`: server-only Regular Web Application credentials; client-secret-post, RS256.
- `IDENTITY_PUBLIC_ORIGIN`: the canonical HTTPS app origin; HTTP is limited to localhost/loopback development.
- Register exactly `ORIGIN/v1/identity/callback` and `ORIGIN/v1/identity/logged-out` as callback/logout URLs.
- Verify the actual tenant's MFA enrollment, amr/auth_time, SSO/remembered-device behavior, recovery, key rotation,
  deletion/retention terms and plan budget using synthetic staff before real clinical access.

Invalid enabled configuration or discovery failure stops the API before listening, without logging secrets. Migration
may already have completed; roll back only to a build that understands version 4. Test an authorized backup copy and
stop older writers before migration. Startup with the flag off does not contact Auth0.

ACCESS-04 still owns invitations, approved legacy linking, role-set UI and per-clinic token cutover/deadlines. No real
clinic is declared migrated by this PR; do not enable clinical rollout before that transition is implemented.
No server session may be revived by restoring an old database: the ACCESS-11 restore workflow must invalidate
all sessions/attempts before serving. Do not treat an ordinary SQLite backup restore as completed identity recovery.
Clinical payload encryption/recovery/activation remain ACCESS-07-B/C/D. Patient grants/diaries remain unavailable.

## Verification

Server tests use real signed synthetic JWTs and code/PKCE exchanges through the production OIDC library. Browser
tests run the real API with a synthetic HTTPS issuer and an ephemeral test CA (test harness only), not an auth
stub. They cover reload, issue, logout preserving the journal, rotation, multi-browser revocation, no-membership
denial and context cancellation. The existing legacy and anonymous patient import regressions remain covered.

Primary API references:
- https://github.com/panva/openid-client/blob/main/docs/interfaces/AuthorizationCodeGrantChecks.md
- https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md
- https://github.com/panva/openid-client/blob/main/docs/functions/buildEndSessionUrl.md
- https://github.com/auth0/docs/blob/master/articles/api/authentication/_logout.md
- https://support.auth0.com/center/s/article/configure-auth0-for-salesforce-multi-factor-authentication-compliance
