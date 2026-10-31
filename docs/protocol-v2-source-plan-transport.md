# R5 source-plan encrypted transport preparation

This is an unconnected protocol-2 adapter, not completion or activation of normalized synchronization. The current runner and API still advertise protocol 1. No UI, startup call, vault floor, reminders or production configuration changes.

## Boundary

`captureSourcePlanCatalog` reads plans, items and migration recovery references in one IndexedDB read transaction. The portable payload uses a vault-scoped owner marker; stable plan/item IDs and original source metadata are retained. The target database determines the local person on application.

The complete catalog travels as one HMAC-addressed AES-GCM record using the existing vault keys and a fresh nonce. Decryption checks the expected record address, envelope kind/protocol, vault ID, catalog schema, ownership and references. The serialized envelope is limited to 2.5 MB before encryption, leaving room for base64 overhead inside the existing 4 MB request limit. Oversized ciphertext is rejected before decryption. No partial catalog is emitted. The embedded redemption receipt remains historical local metadata, not a portable authenticity proof or a clinical grant.

`applySourcePlanCatalog` is an explicit compare-and-replace primitive. It requires a detached expected local catalog, refuses a different configured vault, then checks the vault binding and complete local catalog again inside the write transaction. An intervening local edit or re-pairing aborts. All three source stores replace together or roll back together. It does not replace the legacy journal, move the sync cursor, activate instructions or issue notifications.

## Required before wiring the runner

- Server negotiation and explicit protocol-2 opt-in before any normalized upload; keep the old-client write floor effective.
- Remote revision/concurrency and conflict recovery, including two devices editing offline. The local compare-and-replace guard is not a remote compare-and-swap or a conflict-resolution UI.
- Atomic ordering with legacy journal recovery, first-device/new-device rules, deletion safeguards, rollback/replay handling and bounded payload behavior. One catalog record must not be silently split into partial plans if it exceeds transport limits.
- A rollout flag, a two-device real-API browser scenario and explicit handling of failed upload/acknowledgement and interrupted migration.

Do not simply add the three source tables to the legacy row-by-row last-writer-wins loop or raise `CLIENT_DATA_PROTOCOL` to 2. That would permit partial catalogs and would claim compatibility before conflict handling is implemented.

## Verification

Focused tests cover two local profile IDs, unchanged source and legacy journal, encrypted opaque keys, fresh ciphertext, wrong vault/key/address, ciphertext tampering, authenticated malformed envelopes, dangling references, mixed ownership, stale local edits, re-pairing during decryption, independent database connections racing, and transactional rollback/retry. Full CI and build results are recorded in the PR.
