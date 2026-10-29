# ACCESS-02: additive identity and membership storage

Design input: [ACCESS-01](access-01-contract.md). Requires the versioned runner from ACCESS-00-M. This change is
schema expand and legacy compatibility, not OIDC activation, new clinical authorization or remote patient access.

## Migration 0002

`0001_baseline.sql` remains byte-for-byte unchanged. `0002_identity_memberships.sql` adds:

| Table | Contract |
| --- | --- |
| accounts | Separate identity namespace, constrained pending_link/active/disabled status; no medical payload |
| external_identities | Exact unique issuer + subject, account reference; no email-based merging |
| organization_memberships | Account and clinic references, unique Account–Organization pair, unique legacy member link, active/inactive status |
| organization_membership_roles | Set of admin/doctor roles, unique membership + role, enforced membership reference |

Existing clinic/member/delivery/audit rows, token hashes and IDs do not change. Each old staff record becomes one
separate pending_link account and membership. Its staff ID is preserved as membership ID and reused in the separate
account namespace for that provisional row. Equal names across clinics never imply a shared identity. Inactive staff
remain inactive memberships; no external identity or patient ownership is fabricated.

Invalid legacy roles and orphan organizations make migration 0002 fail transactionally; no table subset or partial
backfill is retained and no guessed repair deletes a legacy record. Migration 0001 can remain successfully recorded:
the runner commits each step independently. Fix the underlying data only after an explicit reviewed operator action.

Foreign-key enforcement is enabled on the server connection. Uniqueness prevents duplicate roles and duplicate
memberships; distinct clinics can be associated with the same verified account later. External identity linking is
not exposed by this change: a pending placeholder is not permission to claim a new external identity with an old token.

## Compatibility while authentication remains legacy

Clinical creation, staff addition, role replacement and deactivation project into the new tables within the same
transaction as the legacy write and audit. A failed projection or audit rolls everything back, including a new clinic.
Token rotation does not create another account or membership.

The existing single-role HTTP contract remains unchanged. Replacing a legacy role replaces its projected role set;
deactivation updates membership status and retains assigned roles for history. It does not disable the whole account
or unrelated memberships. The new role-set table does not widen bearer-token permissions: legacy `role` remains
authoritative until the deliberate ACCESS-04/05 transition. Full AC-24 behavior is therefore still pending.

No patient registration, clinician verification badge, session, consent, grant or report upload is introduced. Local
patient records are not sent to the server. Provider choice is still a separate ADR before ACCESS-03.

## Tests and rollout

Runner-core tests exercise immutable baseline 0001 explicitly; dedicated identity tests cover the whole shipped
sequence and the 1→2 upgrade with existing staff, a delivery and audit. Tests verify unchanged clinical data/IDs,
unchanged hashes, separate equal-name placeholders, invalid-input rollback, role sets, exact external identity keys,
foreign keys and no-op re-run. Existing API, last-admin, cross-clinic and author-only delivery tests remain in force.

Before deploying, run migration on a copy of the newest backup with the API stopped for the actual maintenance
window. A baseline-only database applies `2`; an unversioned legacy copy applies `1, 2`. An old build that knows only
0001 refuses version 2 by design. Do not run a pre-runner server or mix old/new writers against the upgraded database:
old code cannot maintain the projection. No down-migration deletes the new identity tables; revert code only to a
schema-compatible build or restore through a separately verified backup procedure.
