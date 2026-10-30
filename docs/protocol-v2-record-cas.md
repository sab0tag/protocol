# R5 server record revision protection

This extends the not-yet-enabled data protocol 2. Protocol 1 and default vault floors remain unchanged; no real vault is upgraded and the ordinary client runner still advertises protocol 1. Stack after the source-plan encrypted transport preparation.

## Conditional writes

After explicit vault opt-in, every protocol-2 `POST /records` requires `expectedSeq`, a nonnegative safe integer representing the last complete vault snapshot the caller read. This is the per-vault record revision, not the global sequence counter and not the first page of a paginated pull. Missing or malformed revisions and duplicate record keys fail before writing. A protocol-1 request cannot supply a condition and have it silently ignored. Protocol-2 writes to an unupgraded vault return `409 protocol_opt_in_required`.

The Store takes `BEGIN IMMEDIATE` before rechecking the protocol floor, comparing the expected revision, calculating the replacement byte delta and writing the entire batch. A stale batch returns `409 record_conflict` with the authorized vault's current `seq`; ciphertext, byte counts and the global counter remain unchanged. A late write failure rolls the entire batch back. Lock contention returns `503 database_busy` with `Retry-After: 1`.

All protocol-2 record writes use this condition; there is no blind protocol-2 write path. Protocol-1 writes also recheck the current floor under the lock, so an opt-in during request parsing cannot leave an old client writing after cutover. The existing schema is sufficient; no migration or rewrite of ciphertext/history is needed.

A pull's rows, protocol-floor check and cursor are read in one WAL snapshot. An independent write between an empty-row query and cursor calculation cannot advance a client past unseen data. Quota uses the actual replacement delta under the same write lock, allowing an equal-sized update at the limit without allowing concurrent requests to exceed it.

## Client boundary and remaining work

`conditionalVaultApi` sends protocol 2 plus the caller's explicit expected revision. It does not opt in a vault, retry conflicts as blind writes, guess a fresh revision or replace the existing API. The normalized runner is still unconnected.

A conflict is not an automatic retry with the returned revision: pull a complete snapshot, decrypt and reconcile it with the preserved local draft before an explicit retry. A lost successful response also yields a conflict on exact replay; acknowledgement recovery must compare the saved pending ciphertext with the remote record before concluding whether it committed. Remote conflict UX, interrupted migration, first-sync/deletion safeguards, history rollback/replay protection and coordinated legacy/source ordering remain required before rollout. This change is not a claim of backup-restore invalidation or complete multi-device synchronization.

Protocol-2 API compatibility is intentionally tightened before any real client/vault rollout. The real-API transport test now supplies the required initial revision 0. Existing protocol-1 clients and ordinary legacy vaults keep their contract.

## Verification

Tests cover stale full batches, exact replays, deletion tombstones, required revisions/opt-in, duplicate keys, another vault's writes, authentication denial, actual quota deltas, late SQL failure rollback, cutover after preflight, a busy writer/retry, a consistent read snapshot under an independent writer and two independent worker-thread connections racing from the same revision. Full test/CI results are recorded in the PR.
