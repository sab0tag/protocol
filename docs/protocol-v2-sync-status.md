# Protocol 2.0 sync checkpoint — 2026-10-30

This is the current R5/R6 checkpoint. The older `protocol-v2-implementation-status.md` is a historical UI checkpoint dated 2026-10-26 and its main SHA/test counts are not current.

## Ready for review; not merged

- PR #129 — atomic encrypted source-plan catalog transport. Branch `feat/source-plan-encrypted-transport`, base `main`. CI passed at `f43f54b6`: 685 client tests, full E2E 194 passed / 28 conditional skips; preview READY.
- PR #130 — atomic server expected-revision checks and distinct fail-closed conditional endpoint. Branch `feat/source-plan-server-cas`, base #129. CI passed at `4f6eb82d`: 354 server / 688 client tests, full E2E 194 passed / 28 conditional skips; preview READY. Backend code is not deployed to production.

## Delivery slice — PR #131

- PR #131 — branch `feat/source-plan-durable-send`, base #130: durable encrypted pending send, exact acknowledgement recovery after a lost response, preservation of local drafts on remote conflict, per-operation guards against delayed responses and re-pairing.
- Local validation: 699 client tests, typecheck/build and both real-API transport scenarios pass. The new recovery test crosses the fixed 1000-record API page boundary. The exact-head preview is READY and its HTML/module return 200. Full CI results are tracked in PR #131.
- Details and limitations: `protocol-v2-durable-send.md`.

## Next

1. Review the conditional-write capability and guarded opt-in preparation in PR #132; keep the normal runner disconnected.
2. Add explicit baseline/conflict reconciliation without dropping the pending local draft; then first-sync/deletion and coordinated legacy/source ordering.
3. Add restore epoch/replay protection, rollout gating and actual two-device browser flows before wiring the normal runner or enabling plan activation.
4. Continue patient confirmation, execution and consent-bound report flow, with Free/Plus gates and full clinical integration acceptance checks.

No merge to main or production update is authorized by this checkpoint. Product scope remains the agreed TZ; completed transport primitives do not imply the entire clinical flow is ready.

## Capability gate — PR #132

- PR #132 — branch `feat/source-plan-capability-gate`, base #131: distinct authenticated conditional-write discovery and guarded opt-in, including a deployment downgrade between discovery and upgrade. Legacy startup and all real vaults remain unchanged.
- Local validation: 356 server tests/typecheck, 703 client tests/typecheck/build, both real-API transport scenarios and the complete routed-screen matrix at 320/390/768/1024 px in light/dark pass. Phone/desktop Plan screenshots were visually inspected. The exact-head preview is READY and HTML/module return 200. Full CI is tracked in PR #132.
- Details: `protocol-v2-capability-gate.md`. This does not complete the remaining migration/rollout gates above; previews are static frontend verification, not production backend deployment.

## Read-only conflict evidence

- Branch `feat/source-plan-conflict-review`, base #132: authenticated, detached acknowledged/pending/current-local/remote catalogs for later explicit comparison, with missing/deleted/empty distinctions. No automatic merge, acknowledgement or replacement.
- Local validation: 708 client tests/typecheck/build and both real-API transport scenarios pass. Five new review cases cover version separation, absent baselines, malformed data and reviews invalidated by concurrent acknowledgement/re-pairing. Full CI and exact-head preview verification are tracked in its PR. Details: `protocol-v2-conflict-review.md`.
