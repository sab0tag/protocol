# R5 durable source-plan delivery — 2026-10-30

## Scope and integration state

Branch `feat/source-plan-durable-send`, stacked on PR #130 (`feat/source-plan-server-cas`), which depends on #129. The ordinary runner and `CLIENT_DATA_PROTOCOL` remain at protocol 1. No UI calls this adapter, no real vault is upgraded, and no production setting changes. `conditionalVaultApi` remains the HTTP boundary; the optional environment access allows importing that boundary from the Node real-API test as well as Vite.

## Completed

`prepareSourcePlanSend` persists one immutable encrypted catalog plus its explicit expected complete-vault revision before any network request. It uses the existing profile-local sync metadata, with no schema version change. The final transaction compares the vault code, prior delivery state and all three source stores against the state captured before encryption. Concurrent preparation, re-pairing and intervening local edits fail without replacing an existing send. The operation ID is local only; no plaintext catalog is stored in the outbox. Sync metadata is excluded from file backup and from the legacy encrypted row loop.

`deliverSourcePlanSend` validates the saved ciphertext and sends the exact saved bytes and condition. Network failures, quota/authentication errors, an older server's 404, a missing opt-in and malformed acknowledgements retain the pending operation. It never falls back to a blind route or guesses a new condition. The caller may resume after a database reopen. A local edit made after preparation remains untouched and can be prepared separately after the pending operation is acknowledged.

A `409 record_conflict` triggers a bounded full pull from zero. Every page and cursor is validated, including tombstones and later replacements of an earlier apparent match. Only the exact pending ciphertext at a revision greater than its expected revision recovers acknowledgement of a lost successful response. The actual matching record's revision is recorded separately from the legacy cursor; the latter never moves. A different remote winner, deletion or absence returns a conflict while preserving the pending operation and current local draft. The returned remote record is encrypted and is not applied automatically. A later caller must explicitly reconcile before preparing another revision.

Acknowledgement and outbox removal commit together. A storage failure leaves the operation recoverable. A delayed response cannot clear a newer pending operation or write into a re-paired profile. Two callers can attempt the same saved condition; server CAS prevents a second write, and the local state guard rejects stale completion.

## Verification

Eleven unit scenarios cover reopen, export privacy, later local edits, exact lost-response recovery, distinct remote winners/tombstones/absence, pagination and late replacements, unrelated record revisions, old/unavailable servers, malformed acknowledgements, incomplete or malformed pulls, a detectable remote rollback, competing IndexedDB connections, edits during encryption, re-pairing, delayed old responses and acknowledgement transaction rollback/retry.

The real-API Playwright transport suite includes a new scenario: HTTP commit followed by a lost response, database reopen, recovery across multiple real pages beyond the fixed 1000-record server page size, unrelated vault changes, and two devices submitting different local drafts at the same revision. These local stores use independent IndexedDB emulations in Node; this is not a claim of browser conflict UI verification. Existing application/browser regression checks remain applicable because this adapter is unconnected.

## Remaining before rollout

- Server capability negotiation before explicit protocol-2 opt-in. An old server must not be upgraded before conditional-write support is established.
- Explicit conflict resolution UX retaining local and remote versions; complete read/baseline selection and revision-bound retry. Do not retry with the error body's sequence alone.
- First/new-device and deletion safeguards, coordinated legacy/source migration order, and crash recovery for that coordinated migration.
- Restore invalidation and replay/rollback protection across server recovery epochs. Exact ciphertext comparison alone does not prove that an old backup or replay is current.
- Rollout flag, end-to-end browser flows on phone/desktop in both themes, and explicit plan confirmation/activation only after the synchronization gates are complete.

This document records a delivery primitive, not completion of R5/R6 or the full Protocol 2.0 clinical workflow. Full local and remote validation results are recorded in the PR and the current sync checkpoint.
