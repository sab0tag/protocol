# R5 runtime recovery connection — 2026-10-30

Branch `feat/source-plan-recovery-runtime`, stacked on PR #133. This connects existing durable-send recovery and read-only conflict evidence to the real app runner and Sync screen. It does not initialize a new source send, opt in a real vault, merge main or deploy the backend. The ordinary legacy client remains protocol 1.

## Connected behavior

Before any legacy cursor/journal/policy/schedule operation, the runner checks for a source delivery context. A persisted pending send first requires authenticated conditional-write discovery and an already opted-in vault. Recovery uses the saved ciphertext/condition; unsupported or unprepared servers preserve the queue without an opt-in or fallback write. A successful/lost-response acknowledgement is recorded by the existing guarded primitive. A conflict loads authenticated acknowledged/prepared/current-local/remote versions into the Sync screen, with native expandable version panels and original source text. There are no automatic medical choices or nonfunctional replacement controls.

A source context stops this device from falling through to the protocol-1 round. The screen explicitly distinguishes a source-send acknowledgement from a complete diary sync, and does not update the legacy cursor, last full-sync time or source plans. The normal path for profiles without a source context retains its existing behavior. Starting new source uploads and a complete normalized migration remain unavailable until their ordering, first-device and restore/replay gates are implemented.

Stopping a source-context device pauses it durably instead of deleting the encrypted queue, baseline or code. The confirmation explains retained local credentials/data. Reload stays paused, and explicit Resume reuses the same vault and operation. A generation guard prevents old asynchronous completion from updating the resumed/stopped runner or proceeding into later legacy steps. The send primitive rechecks pause before acknowledging. Pairing controls are hidden for paused/source-context devices because the legacy join path cannot yet accept normalized vaults.

A successful file restore atomically adds a `restore` barrier to any source delivery context while preserving its encrypted evidence. Runtime recovery never POSTs that pre-restore send automatically. A failed restore rolls the barrier back with the data. The Sync screen explains the barrier and hides stale conflict evidence. Backup copy no longer claims active synchronization for paused/source-context devices. This local barrier does not establish server restore epochs or complete replay protection.

## Verification

- Unit checks cover the existing delivery/inspection cases plus restore barrier/evidence retention, restore failure rollback, pause during accepted HTTP and exact recovery after explicit resume.
- Five actual browser IndexedDB + real local API cases exercise startup lost-response recovery, conflict comparison across refresh/stop/resume and 320/1024 px light/dark, offline recovery, unsupported discovery without source/legacy writes, and actual file restore blocking replay across reload. All fixtures are synthetic; unlike the earlier Node transport tests, these scenarios run the application runner and visible Sync screen.
- The existing two-browser pairing/meal/deletion and old-client denial regressions remain required. Client tests/build, full remote CI, preview and visual results are recorded in the PR/current checkpoint.
- React checklist applied: components remain at module scope, version lists use stable IDs and preindexed items, native details provide keyboard interaction, 44px summary targets and narrow-layout wrapping are checked, copy lives in the Ukrainian dictionary, and paused/restored/stale reviews do not expose an active decision control.

## Remaining

Explicit resolution with retained recovery versions; coordinated legacy/source migration and first/new-device/deletion rules; server restore epoch/replay protection; controlled creation of new source sends; and full plan verification/activation. Do not interpret this runtime recovery connection as a completed automatic protocol-2 rollout or a real backend deployment.
