# R5 conditional-record capability and guarded opt-in — 2026-10-30

Branch `feat/source-plan-capability-gate`, stacked after PR #131. This is an explicit, unconnected API preparation slice. The normal runner remains protocol 1. No real vault is upgraded and no production API is deployed.

## Problem

Servers predating atomic revision protection already returned `supported: 2` from `/write-protocol` and accepted a generic protocol-2 opt-in. That response cannot establish support for conditional record writes. Upgrading a vault on such a server would strand a client that correctly refuses blind writes. A discovery check alone also leaves a gap if a server is downgraded between GET and PUT.

## Contract

- Authenticated `GET /records/conditional/capabilities` returns `{ v: 1, protocol: 2, condition: 'vault-seq', minimum: 1 | 2 }` with `Cache-Control: no-store`. It does not change the write floor, records, revision, byte counts or reminder queue. Existing authentication activity tracking still applies.
- Authenticated `PUT /write-protocol/conditional-records` accepts exactly the required values `{ minimum: 2, protocol: 2, condition: 'vault-seq' }`. It invokes the existing atomic floor upgrade and one-time old reminder queue retirement. Repeated calls do not retire a fresh protocol-2 queue. Malformed or unauthenticated claims cannot upgrade. Lock contention retains the existing retryable 503 contract.
- Both paths are distinct from the old generic routes. An older deployment returns 404 even if it takes over after discovery; the client cannot silently opt in through an old PUT.
- `optInConditionalRecords` validates the new discovery response, sends only the guarded PUT and validates its acknowledgement. It never falls back to generic discovery/upgrade, lowers a floor, retries blindly or enables local migration. A lost PUT response has an uncertain result: the server may already be upgraded. Only a deliberate later call after the migration/rollout prerequisites may recheck/repeat the idempotent guarded opt-in.

The historical `/write-protocol` contract is retained for existing compatibility tests/callers. It is not used by this new client helper. This gate establishes conditional-write API support, not full normalized data compatibility, source/legacy ordering, conflict UX, restore epochs or readiness for a production cutover.

## Verification

Client tests cover supported legacy/upgraded floors, old generic support claims, malformed discovery, auth/404/busy failures before either phase, downgrade between GET and PUT, malformed/lost acknowledgement and absence of fallback or extra requests. Server tests cover authenticated discovery with unchanged data/queue, malformed/unauthenticated guarded claims, per-vault isolation, explicit conditional writes after cutover, old-client denial and repeated queue-safe opt-in. Both real-API transport scenarios use the new discovery and guarded PUT before any synthetic protocol-2 write. Full validation is recorded in the PR and sync checkpoint.

## Next

Explicit baseline/conflict reconciliation retaining both versions; first-sync/deletion safeguards; coordinated legacy/source migration; restore epoch/replay protection; rollout flag and actual browser migration/conflict flows. Do not connect this helper to startup until those gates are complete.
