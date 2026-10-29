# ACCESS-04-B: staff invitations and per-clinic token cutover

Base: main `038561e` (#118). Adds migration **0005_staff_onboarding**; migrations 0001–0004 are unchanged.
No real tenant, SMTP account, paid service, clinical database or production flag is provisioned or enabled here.

## Invitation boundary

A fresh MFA session admin selects an address, display name, explicit role set (`admin`, `doctor`, or both) and either a
new staff record or a specific existing provisional record. The secret is random 256-bit, stored only as SHA-256 and
expires after 72 hours. Email is a contact check and never an identity key: Account still resolves by exact issuer/sub.
Resending revokes previous pending invitations for the same address or target staff in that clinic.

OIDC now requests `openid email`. Only the email from a signature-verified ID token with boolean `email_verified=true`
is stored in the session. Missing, false or string `"true"` is insufficient. Existing version-4 sessions get NULL contact
on migration and must re-authenticate before accepting. Contact normalization trims outer whitespace, lowercases the
domain and preserves the local part. No provider roles or organization claims grant permission.

The recipient needs the secret, a live MFA session, authentication within ten minutes, matching verified address and
an explicit acceptance. Preview discloses clinic/roles only after these checks. Wrong address, expired/revoked/used
secret or changed authority creates no membership. The inviter must still be an active admin at acceptance; operator
bootstrap is separately trusted. Linking refuses an already identified target or existing membership in this clinic.
A changed/deactivated target cannot be reclaimed through an old invitation.

Acceptance owns one BEGIN IMMEDIATE transaction: recheck live evidence, resolve exact target, reassign its membership
to the authenticated account (or create a new staff author record), write the exact role set, consume the invitation
and append audit. Any failure rolls back. Concurrent acceptances through separate SQLite connections produce one
success. Existing clinic/member/membership IDs, deliveries and immutable issuer snapshots stay unchanged. Unused
provisional accounts become disabled tombstones; they are not merged by email. New staff author records get a random
unusable bearer credential which is never returned or mailed.

## Mail submission and failure recovery

Protocol uses a configurable SMTP adapter, with verified TLS (implicit TLS or mandatory STARTTLS), bounded timeouts,
no SMTP traffic logging, no file/URL loading and a fixed subject. The mail contains the clinic, selected roles, expiry
and invitation link, without patient/plan data. Production cannot disable certificate verification.

Lifecycle: `sending` reservation + audit commits before I/O; SMTP submission occurs outside SQLite transactions;
`sent` + audit commits after rechecking the inviter under the write lock. Acceptance requires `sent`. A concurrent
revocation/resend cannot be undone by a late SMTP response. SMTP failure leaves an unusable `failed` invitation.

SMTP acknowledgement proves submission, not inbox delivery. If the process dies or a database/audit write fails
between submission and finalization, the received link may remain unusable. Admin sees a non-accepted record and
resends, producing a new secret. Secrets are not stored in an outbox and there is no automatic retry which could
resurrect a revoked invitation. Contact-bearing invitation records are removed thirty days after expiry; audit has
IDs/action categories, not addresses, display names, secrets or mail responses.

## Browser flow

The email link uses a fragment. The invitation screen captures the code in tab memory and immediately clears it from
the URL; no localStorage/sessionStorage/IndexedDB persistence. Login/step-up opens another tab so the secret is never
placed in an OIDC return parameter or login-attempt row. Return to the original tab and check login/preview. Closing
or reloading the tab requires reopening the original email. No invitation is accepted during a callback or preview.
The screen shows clinic, display name, role set and expiry; an unchecked consent checkbox gates the accept action.
Changing accounts requires a new preview. Provider verification/recovery remains the provider's process.

The admin UI lists active/inactive and linked/unlinked staff, manages role sets, sends/revokes invitations and reports
SMTP submission honestly. Context changes unmount clinic state, abort old requests and never mix drafts. Admin and
doctor roles remain independent; no patient diary/report permission follows from registration or membership.

## Operator bootstrap

The first clinic/admin still comes from the operator-managed `clinic:create`. An old bearer is insufficient for an
HTTP invitation or identity claim. The operator sends the first invitation to its exact provisional staff ID:

```sh
npm --prefix server run clinic:invite -- '<organization-id>' '<existing-member-id>' '<recipient-address>'
```

Run alongside the API only with a current schema, explicit existing DB_PATH, APP_ORIGIN and staff SMTP config. The
CLI never creates/migrates a database and checks the schema again inside each write transaction. It obtains the name
and roles from the existing target and refuses if these change before reservation. It prints invitation ID/expiry,
never a secret or link. It sends a real email when configured; use only an intentionally selected recipient.

Server-only config: STAFF_SMTP_HOST, STAFF_SMTP_PORT (default 465), STAFF_SMTP_FROM (single address), STAFF_SMTP_USER,
STAFF_SMTP_PASSWORD; optional STAFF_SMTP_TLS_MODE (`implicit` or `starttls`) and STAFF_SMTP_SERVERNAME. Port 465 always
uses implicit TLS; other ports use mandatory STARTTLS unless explicitly configured for implicit TLS. No host means
invitation sending is unavailable, with no network connection. Partial/unsafe configuration refuses API startup when
identity is enabled. Credentials belong in the existing secret mechanism, not source or browser config.

## Role sets and cutover

The session-only roles endpoint applies exact validated sets under the same lock as fresh MFA and audit checks.
Adding a membership role never widens an existing single-role bearer. Removing its role invalidates that credential.
The last usable administrator cannot be removed, including after legacy auth has expired.

Each clinic separately opts into identity migration after all active staff have linked to identified accounts.
The admin sees the remaining IDs/count and explicitly confirms the deadline: immediately, one day, or seven days.
API accepts integer grace from 0 through 168 hours. A deadline can be shortened, never extended or reset. Inactive
unlinked records stay inactive; no forced merge. Clinics not yet migrated keep their existing token behavior.

The legacy policy rechecks the stored deadline on every service operation, including under a write transaction;
this check is independent of CLINIC_IDENTITY_V2. Turning off identity routes cannot revive expired tokens. Rollback
to a pre-version-5 build is refused by migration history. No legacy columns or records are deleted.

## HTTP surface

All routes are no-store. Cookie mutations require exact Origin and CSRF; issuer-provided email in request JSON is ignored.

| Route | Contract |
| --- | --- |
| GET/POST /v1/clinic/invitations | Admin listing; fresh MFA session to create/send |
| DELETE /v1/clinic/invitations/:id | Fresh MFA session admin, own clinic only |
| POST /v1/session/invitations/preview | Secret in body; fresh MFA and matching signed address |
| POST /v1/session/invitations/accept | Explicit acceptance, same evidence rechecked atomically |
| PUT /v1/clinic/staff/:id/roles | Exact role set; session admin + fresh MFA |
| GET/POST /v1/clinic/auth-transition | Own-clinic migration report / confirmed bounded deadline |

Invitation errors: bad_request=400, recipient_mismatch=403, not_found=404 (also expired/revoked/used), conflict=409,
unavailable=503. Existing MFA/freshness/CSRF and database_busy contracts apply. No new credentialed CORS surface is
introduced: these use the protected clinic/session paths accepted by #118.

## Validation and operational gates

Tests cover signed email evidence, wrong/unverified recipient, secret hashing, expiry/revoke/resend, mail failure and
in-flight revoke, legacy authorship preservation, role/context isolation, audit rollback, independent-connection
acceptance race, bootstrap schema guard, cutover maximum/non-extension and denial with identity routes disabled.
Browser fixtures use a real local TLS SMTP server and signed synthetic HTTPS OIDC provider, with no external mail.

Real rollout still needs the actual Auth0 EU tenant/MFA/recovery/contact claims, SMTP sender/delivery configuration,
monitoring and ADR 0001 checks. ACCESS-11 restore invalidation remains required before live access. Invitations do
not verify medical qualifications. Encryption, lost-response recovery, plan versions and patient binding/sharing
remain their own ACCESS-07/06/08 work. Local patient use stays account-free.

Local checks on Node 24: 329 server tests, 671 client tests, both typechecks and production build. Selected real-API
browser coverage includes seven passing clinic/login/invitation scenarios; full CI remains required before merge.
