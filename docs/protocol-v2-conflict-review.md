# R5 read-only source-plan conflict evidence — 2026-10-30

Branch `feat/source-plan-conflict-review`, stacked on PR #132. The adapter remains disconnected from the ordinary runner and UI; no vault opt-in or production deployment occurs.

`inspectSourcePlanConflict` reads a complete bounded remote snapshot and returns four separate versions: the last acknowledged catalog (if this device has one), the encrypted pending send decrypted for review, the current local catalog including edits after preparation, and the current authenticated remote catalog. The remote version has an explicit `missing`, `deleted` or `catalog` state. Absence or a tombstone is never presented as a genuinely empty catalog; a missing baseline is never inferred from either side.

All present ciphertext is authenticated and schema/vault/owner checked before a review can be shown. The final local transaction reads all source stores consistently and verifies the original vault code and delivery state. Re-pairing or another caller completing/replacing the pending operation invalidates the review. Returned catalogs are detached and portable; their source metadata and historical receipts do not establish a new clinical grant.

The result records the pending operation ID, its expected revision, the complete remote revision and two factual comparisons: whether the local catalog changed after preparation and whether the exact pending ciphertext is currently present remotely at a later revision. It does not move the legacy cursor, acknowledge a send, replace a plan, clear a pending draft, merge instructions or choose a dose/time. Even an exact remote match remains read-only; acknowledgement recovery is the separate delivery operation. The returned revisions are evidence for a later explicit decision, not permission to retry with a new condition.

Pagination validation now also rejects a final empty page that advances the cursor: on this server, an empty page's cursor equals the supplied cursor. A malformed page must not fabricate a complete snapshot or a conflict revision.

## Verification and next boundary

New unit scenarios preserve all four distinct versions, distinguish missing/deleted/empty remote data without inventing a baseline, recognize a committed pending packet without acknowledging it, refuse foreign/corrupted remote or baseline data, and reject a review invalidated by concurrent acknowledgement or re-pairing. The real-API delivery scenario now decrypts and compares the losing device's local/pending catalogs and the winner's remote catalog while proving that review leaves its metadata unchanged.

Next: design the explicit resolution transaction and recovery retention for both versions, then connect a review UI behind the still-disabled normalized sync rollout. First/new-device, deletion, coordinated legacy/source migration, restore epoch/replay protection and complete phone/desktop browser flows remain prerequisites. This primitive is not a complete conflict resolution screen or completion of R5/R6.
