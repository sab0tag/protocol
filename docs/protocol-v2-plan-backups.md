# R5 source-plan backup compatibility

The app still uses its existing authoritative journal. This boundary preserves prepared source-plan data in JSON recovery files; it does not enable a writable multi-plan catalog, change notifications or claim normalized records already sync through the vault.

## Format and restore

- Ordinary journals continue exporting format 2. If any normalized records exist, export uses format 3 and includes all source plans, items and migration snapshots in the same read transaction as the journal. Older apps reject the newer version instead of silently dropping its records.
- Photos, document review drafts, raw documents and local profile names/directory remain outside this clinical backup, as before. This is a one-person restore, not a family backup or access grant.
- The parser checks plan/item identity, ownership, lifecycle/version, provenance kind and migration references. A mixed-person file, dangling relationship or duplicate identity fails before a write. Direct import callers also use the validated detached file.
- Explicit restore binds source-plan ownership to the chosen local profile database. Stable source plan/item ids, versions, instructions, annotations and recovery snapshots are retained. Local directory ids differ across devices and are never a server authorization claim. New deterministic legacy ids do not embed a device-local owner; older retained identities remain supported.
- Plan data, migration snapshots, journal replacement and preference-history merge commit atomically. A late write failure rolls them all back. A format 1/2 file cannot replace a target that already has normalized data; the existing data stays intact and the error explains the need for a complete copy.
- The existing replacement confirmation discloses the actual count of source plans and asks the person to verify the correct profile. Choosing a file alone does not restore it. Module preference history keeps its existing merge semantics.

## Remaining rollout gates

Prepared records are not live clinical consumers. Before activating multi-plan writes, implement owner-scoped encrypted sync and old-client compatibility, then feature-flagged catalog/Today readers and verified activation. Importing preparation metadata is not permission for automatic medical activation or source-plan merging.

## Verification

534 client tests and production build/typecheck passed. The focused backup/domain/storage/legacy compatibility set passed 55 cases. Three Chromium scenarios passed: portable format-3 restore and old-format refusal, native v10 upgrade, and existing module preference backup behavior. The new confirmation was inspected at 320/1024 in both themes with synthetic data. Remote CI/preview is recorded in the PR.
