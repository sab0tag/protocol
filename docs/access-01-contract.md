# ACCESS-01: identity and authorization boundary

Date: 2026-10-29. Scope: documentation only. Baseline inspected: `ecc1950ce52db0583a4be3bcc3c37597eed6615c`
(ACCESS-00-M on reviewed ACCESS-00-H). This describes the implementation at that SHA, not an assertion that all
requirements of the access specification are shipped. Identity-provider selection is a separate, unresolved ADR.

## AS-IS map

| Boundary | Implementation | Current authority |
| --- | --- | --- |
| Patient diary | browser IndexedDB, local profile selection | possession of the local device; no remote identity inferred |
| Clinical staff | `server/src/clinic/directory.ts`, `clinic_members` | hashed bearer secret, active member, one `role` |
| Clinical API | `server/src/clinic/routes.ts` | organization from authenticated staff record, checked role |
| Delivery | `server/src/clinic/delivery.ts`, `plan_delivery` | issuing staff ID for status/revoke; random secret for anonymous redemption |
| Delivery audit | `clinic_audit` | staff ID or system marker `patient_link`; no patient identity inferred from that marker |
| Patient import | `src/screens/PlanImportScreen.tsx`, `src/data/carePlans.ts` | preview and explicit local draft save; no automatic daily activation |
| Schema | `server/src/db`, baseline 0001 | 25 application tables and 6 explicit indexes; version/checksum/manifest verification |
| Operator CLI | `clinic:create`, `stats:*` | existing current database, schema validation only; no patient-data grant |

`/v1/clinic/me`, `/staff`, staff role/token/deactivation routes, `/audit`, `/stats` and `/plans` are staff-authenticated.
`POST /v1/clinic/plans/redeem` is anonymous and rate-limited. The code is a delivery capability, not a patient account
or an ongoing permission. The report-sharing/profile-binding/session APIs in the target specification do not exist yet.

Current protections: same-clinic foreign delivery IDs and cross-clinic IDs return 404; clinical admin alone cannot
issue plans; the last active administrator is retained; redemption is a write-locked transaction; corrupt payloads
end in terminal `tampered`; a database lock is a retryable error. Pending payload is still plaintext, clinician name
is client-supplied, and a response lost after successful redemption has no recovery window yet.

## Threat model and enforcement contract

| Threat | Required decision and enforcement |
| --- | --- |
| Doctor guesses another doctor's delivery ID | author + organization checked in service/query; no content/status or mutation on denial |
| Staff changes organization ID in request | membership established by server; request organization is only a checked selector |
| Clinic administrator grants themselves access to a patient | organizational role does not create a care relationship or grant |
| Link holder is mistaken for identified patient | delivery token and audit marker never create Account/profile ownership |
| Identical names/emails merge unrelated people | no automatic linking; external identity key is `(issuer, subject)` |
| Switching profile/clinic leaks prior response | separate cache namespaces; cancel queued work and disregard obsolete-context responses |
| Revoked/disabled actor reuses a session/token | re-read live authority on every protected operation; no fallback that widens permissions |
| Offline work/backup revives access | revalidate grant generation during processing; apply revocations before restored shared data is served |
| Migration silently accepts a different schema | validate complete known manifest even if no migrations remain; refuse before serving |

For future patient-data access, permission requires an active authenticated account, active receiving membership,
allowed operation, matching subject/resource, and an unexpired/unrevoked grant with the exact scope and data period.
Missing authority means denial. Lists, counts, nested resources and downloads obey the same object policy. Foreign
objects, including another doctor's delivery in the same clinic, are 404; prohibited functions on an otherwise
visible resource are 403; unauthenticated operations are 401. UI visibility never authorizes a request.

## ACCESS-02 expand decision

Add separate Account, ExternalIdentity, OrganizationMembership and membership-role tables. Keep existing clinic,
staff, delivery and audit IDs, hashed bearer secrets and current HTTP contracts. An Account can have many clinical
memberships; each membership has a set of roles. Neither a patient profile nor an external identity is fabricated
from a clinical member's name or secret.

Each pre-existing staff row initially maps to its own provisional Account (`pending_link`) and membership, preserving
the staff ID as membership ID. The provisional Account ID may equal the staff ID in its separate namespace. This is
an isolated technical placeholder, not evidence of a real person's identity. Never merge these placeholders across
clinics automatically. Activation/linking requires a later authenticated flow; possession of the old token is not
sufficient proof for linking a new external identity.

Existing one-role API remains authoritative for legacy authentication until ACCESS-04/05. During expand, staff
creation, role replacement and deactivation must update the additive membership projection in the same transaction
as their legacy row and audit. An old role-replacement request replaces the projected role set; it must not invent
admin+doctor authority. New role-set storage is expressible and tested, but it does not enable a hidden new login,
remote patient access or the full AC-24 UI behavior. Token rotation never links an account or creates membership.

External identities are unique by exact issuer and subject. One active Account–Organization membership is unique;
role values are constrained, references enforced. Invalid legacy/orphan rows cause a transactional migration refusal
for operator review, not silent deletion or a guessed repair. The baseline file remains byte-for-byte immutable.
Migration 0002 must work both after a real baseline with staff/deliveries and from a fresh database, rerun without
changes, and preserve clinical data/IDs. New tables and dual writes require no user-facing registration step.

## Dependency and release gates

ACCESS-00-H -> ACCESS-00-M -> ACCESS-02. This document is the design input for ACCESS-02. OIDC/MFA/session work
waits for ACCESS-01-IDP and ACCESS-03; it does not block additive schema work. Grant/scopes, adult self-binding,
report sharing, verified issuer, encrypted delivery and recovery remain separate tasks. Patient activation of plan
versions waits for R5/R6; a server-side immutable document snapshot does not.

Identity-provider ADR must record hosting/data location, MFA and recovery, invitations, session integration,
operational ownership and cost before any external provider is provisioned. No provider or paid account is selected
by this document. Clinical content is never sent to the identity provider.

For each change: direct API denial tests, migration data preservation/rollback tests, live role/deactivation tests,
build/typecheck and the relevant browser regression. Full CI precedes merge. Vercel's daily quota is an explicitly
accepted exception for the current development session; it is not permission to bypass failed code checks.
