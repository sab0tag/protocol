# ACCESS-04-A: clinic contexts through server sessions

Builds on ACCESS-03 (#112), ACCESS-05 and ACCESS-07-A. This is the first part of ACCESS-04, not completion of staff
onboarding. The existing `CLINIC_IDENTITY_V2=on` flag remains off until operational and migration gates are met.
No production settings, tenant, paid service, real invitations or live databases are changed.

## Serving topology

Preserve the accepted same-site API topology: the app calls the configured `VITE_API_URL`, the session cookie belongs
only to the API host, and authentication/callback remain `/v1/auth/login` and `/v1/auth/callback`. No proxy, cookie
Domain or second identity/session schema is introduced. The public `/v1/auth/config` reports enabled status only.

With identity enabled, credentialed CORS extends to protected `/v1/clinic/*` for the exact configured `APP_ORIGIN`.
Allowed request headers include `X-Clinic-Id`, `X-CSRF-Token`, Content-Type and Authorization. Foreign origins receive
no allow-origin. The anonymous `/v1/clinic/plans/redeem` route retains its original non-credentialed CORS and link-based
contract; it must not depend on a staff session. Other APIs retain non-credentialed CORS.

## Authority and clinical operations

A cookie request requires a live server session and signed MFA evidence from ACCESS-03. `X-Clinic-Id` is a selector
among that account's active memberships, never authority. Multiple memberships require an explicit selector; absent,
disabled, foreign or unlinked memberships grant no clinical access. A corresponding active staff record is required
while the legacy projection remains the author identity for existing deliveries. No email/name/token-based linking
or new membership is performed by this change.

The directory rechecks the session, account, exact membership, active staff record and current role set on every
service call, including after obtaining the write lock. A cached Actor is not permission. Service checks do not extend
the idle timeout. Revocation/disable/role changes prevent the next operation even when a browser keeps its cookie.
Missing/future/stale authentication time denies staff mutations; re-authentication must be within ten minutes and
MFA must still be present. CSRF plus exact Origin is required for every cookie-authenticated clinical mutation.
Invalid cookies and mixed cookie/bearer credentials are rejected, without retrying with an old token.

The existing object policy and SQL author filters remain in force: a doctor cannot inspect or revoke a colleague's
delivery, an admin-only membership cannot issue plans, and no role grants patient diary/report access. Role sets
support admin + doctor in the selected context. Additive roles do not widen a legacy bearer's single role. Last-admin
checks account for usable session administrators as well as usable legacy administrators.

## Browser behavior

The clinic screen restores a session after reload, explicitly selects a clinic when necessary, and keeps the current
clinic visible. Context changes abort requests, unmount the previous content/drafts and discard late responses.
Revoked or denied contexts clear private content. CSRF, clinic selector and temporary bearer values remain in tab
memory. Staff responses are no-store and are not persisted for offline reading.

Logout/revoke-all clears the working view and revokes Protocol sessions on the server without deleting the local
patient journal. A failed logout keeps retry controls visible. Provider SSO logout remains outside this change;
a subsequent explicit login is a new operation, not reuse of a revoked Protocol session. The page does not claim
that all upstream provider sessions were ended.

Fresh `/clinic` and `/plan/import` routes do not require patient onboarding or mark it complete. Ordinary local use
continues without an account. Legacy token entry remains explicit and temporary until per-clinic cutover is ready.

## Remaining ACCESS-04 work and rollout gates

- Protocol-managed 72-hour single-use invitations, hashed secrets, verified recipient address and explicit acceptance.
- Operator-approved linking of existing staff placeholders, preserving delivery author IDs; no self-claim by bearer.
- Invitation mail adapter configuration and delivery verification. No real email provider or sending is provisioned.
- Role-set management UI and per-clinic legacy allowlist/deadline, at most seven days from clinic migration.
- Real-tenant MFA, recovery, key rotation, serving/cookie/CORS checks and restore invalidation gates in ADR 0001/ACCESS-11.

Do not enable a real clinical rollout until these gates are complete. Clinic creation remains operator-managed.
Migration 0004 and earlier are unchanged; this PR adds no schema migration.

## Verification

Server tests cover HTTP transport and service boundaries, CSRF/Origin, exact-context selection, same-clinic IDOR,
admin/doctor separation, role sets, legacy separation, disable/revoke, idle/freshness and credentialed CORS isolation.
A worker with its own SQLite connection proves revocation is checked again after waiting for another writer.
Browser tests use the real API, signed synthetic HTTPS OIDC provider and explicit fixture-only membership links:
login/reload, issuance, logout preserving a local journal, step-up, two-browser revoke-all, unrelated account denial
and context cancellation. The anonymous patient import path is exercised independently of staff cookies.

Local validation on Node 24: 291 server tests, 671 client tests, both typechecks and production build; seven selected
browser scenarios pass. Full CI is required before merge. These synthetic checks do not certify a real Auth0 tenant
or complete ACCESS-04 onboarding.
