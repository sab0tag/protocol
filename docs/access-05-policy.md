# ACCESS-05: shared clinic object policy

Baseline: main `cd367454cfd1622c214edab720ace0b69b1eb521` (ACCESS-02). No schema migration or new HTTP authentication path.

## Enforcement

`server/src/clinic/policy.ts` owns a single object decision and live authority resolution. `ClinicDirectory.require`
adapts the existing server-authenticated Actor; services enforce the policy independently of HTTP middleware.
Clinic profile, staff lists and mutations, audit, organizational statistics, plan issue and delivery status/revoke
all pass through it. Existing role-permission definitions remain in `roles.ts`; canonical permission names map to
their compatible legacy names. Own-draft policy is defined, but no server draft storage/API is introduced.

| Subject | Live authority | Restrictions |
| --- | --- | --- |
| Legacy bearer Actor | legacy member role and active flag, matching active membership, non-disabled Account | provisional `pending_link` accounts remain usable; additive membership roles never widen bearer authority |
| Future authenticated membership reference | exact Account + membership + organization, active Account and membership, current role set | pending/disabled accounts fail; authenticated session/MFA must be established by ACCESS-03 before constructing this trusted server reference |

Membership references are an internal policy input, not credentials. No request body, header, unverified JWT or
client-selected organization can construct an authenticated subject. There is no new endpoint accepting these
references. ACCESS-03/04 must connect verified server sessions and organization switching before membership
subjects can be used by HTTP services. Existing service signatures still accept legacy Actors; this PR does not
claim end-to-end multi-role login/UI (AC-24).

Organization, staff, delivery and draft are separate resource kinds. Author checks use membership's preserved
legacy member ID for existing delivery rows; after linking, Account ID never becomes a delivery ownership key.
An admin+doctor membership can perform both organizational and doctor actions, but cannot access a colleague's
delivery. The same account's membership in another clinic inherits neither roles nor authorship.

Unknown actions and all patient diary/report scopes are denied. No wildcard, implicit care relationship, team
permission, report grant, profile ownership or emergency bypass is introduced. Future snapshot sharing must add
its real grant/scope/profile/expiry checks here and at its service boundary with its own acceptance tests.

Unauthenticated/disabled subjects return 401. Disallowed functions return 403 (including admin-only attempt to
issue or inspect a plan). Another author's or tenant's delivery returns 404 for a doctor, identically to a missing
ID. Queries retain `org + issued_by` filters in addition to policy enforcement. Staff lists, audit and stats apply
the tenant filter in SQL before ordering, grouping or limiting. No plan content is returned by staff APIs.

## Transactions and compatibility

Write operations check authority again after `BEGIN IMMEDIATE`: issue/revoke, staff creation/role/deactivation,
and token rotation. Authority may have changed while SQLite waited for another process. Token rotation and its
audit are now atomic too. A denied write rolls back without clinical changes or success audit. No nested
transaction is introduced into anonymous redemption or audit.

The database is still version 2; existing baseline and identity migration checksums remain unchanged. Existing
operator schema validation and last-admin rules remain. Legacy tokens stay in tab memory. The anonymous QR/link
redemption contract, expiry, retry and lost-response limitations are unchanged. Account disable intentionally
suppresses legacy login as well as membership access; re-enabling one membership cannot override account disable.

Tests cover the role × tenant × author × resource matrix, aliases and default denial, exact membership binding,
provisional versus active accounts, live role/disable changes, preserved authorship after relinking, service-level
IDOR without middleware, and direct HTTP denials with no audit/data mutation. Separate worker connections verify
that all six write operations reject an actor disabled after preflight but before lock acquisition/commit.

Remaining dependencies: ACCESS-03 session/MFA verification; ACCESS-04 invitations/context/role-set UI and legacy
transition; ACCESS-06 profile binding; ACCESS-08+ real grants and report sharing. No deployment or production data
change is performed by this PR.
