# ACCESS-07-A: issuing staff and immutable delivery snapshots

Base: main `2c54e50c820d2f1406afda33127cfdad49404fd5` (ACCESS-05). Applies to current legacy staff authentication;
OIDC/MFA and identity linking remain ACCESS-03/04. A valid staff credential identifies the issuing member, not a
medical qualification check.

## Issue contract

`POST /v1/clinic/plans` still accepts the strict CarePlanV1 document and explicit transmission consent. Organization
must match the authenticated member. An issuer supplied in the document is rejected; unrelated request-body
claims cannot override server authority. Nested clinician fields are strict too.

Under the same `BEGIN IMMEDIATE` as issue/audit, the service rechecks live policy, reads the member's real display
name, organization name and membership ID, and captures server time. The stored document is DeliverySnapshotV1:

- `snapshotId`: server-created delivery ID; never the client-supplied plan ID.
- `issuedAt`: server issue time.
- `issuer`: preserved staff author ID, membership ID, organization ID and issue-time name snapshots.
- `source`: client's original plan ID, issue date and declared clinician/organization names, all source claims.
- `plan`: CarePlanV1 with server issuer names/time; medical fields remain unchanged.

Each issue creates a new immutable document, even when the client reuses a plan ID. There is no API to replace its
content or issuer. Mutating input objects, renaming staff or changing the clinic name does not rewrite pending
snapshots. Existing author/organization filters continue to protect status and revoke. Terminal transitions may
erase the payload; this is not an indefinite server archive of clinical plan versions.

The whole snapshot is hashed, including provenance. Redemption validates schema, hash, delivery ID, author,
organization, time and normalized plan/issuer consistency in the existing atomic transaction. Corruption commits
terminal `tampered`, clears the payload and writes one category-only audit. No names or instructions enter audit.

## Storage version and compatibility

Migration 0003 adds `plan_delivery.format`: existing rows default to 1, new snapshots use 2. Historical payloads,
hashes, IDs and statuses are not rewritten. Legacy rows redeem as unverified source documents; current staff names
cannot retrospectively certify their author. Version 3 prevents old builds from opening a database containing a
format they cannot redeem. Migrations 0001/0002 remain unchanged.

Redemption still returns `plan` for older clients and additionally `snapshot` for format 2. Older clients therefore
see actual server issuer names on new issues. Updated clients distinguish server issuer from the source's declared
doctor. `redeem()` remains the plan-only internal compatibility method; HTTP uses `redeemWithProvenance()`.

Patient drafts keep the receipt in the existing CarePlan source. New draft identity uses snapshot ID: retries
deduplicate, independent reissues cannot overwrite one another. Legacy imports keep their previous identity.
Items remain pending, with no automatic dose verification, scheduling or activation. Logical plan version numbers,
diff/acceptance and cross-version reconciliation remain ACCESS-07-D/R5/R6.

## Trust and rollout limits

Only a response fetched from the configured API enters `previewClinicRedemption`. File/pasted document parsing
uses `previewClinicPlan` and cannot promote arbitrary issuer fields or a snapshot envelope into confirmation.
Saved receipt metadata records its acquisition; it is not a cryptographic signature, proof of current access,
proof of qualifications, or portable verification for an exported JSON file. Future backup/import handling must
not trust client-supplied receipt fields as a fresh server confirmation.

Payload is still plaintext until ACCESS-07-B; hashing is integrity detection, not encryption. Successful redemption
erases it, so lost-response recovery still waits for ACCESS-07-C. No clinical content is retained in a second table.
Before API deployment, stop older writers and test migration on a synthetic database and an authorized backup copy
in the maintenance workflow. This PR does not deploy the API or access production data.
