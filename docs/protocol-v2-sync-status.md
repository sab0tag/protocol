# Protocol 2.0 sync checkpoint — 2026-10-30

This is the current R5/R6 checkpoint. The older `protocol-v2-implementation-status.md` is a historical UI checkpoint dated 2026-10-26 and its main SHA/test counts are not current.

## Ready for review; not merged

- PR #129 — atomic encrypted source-plan catalog transport. Branch `feat/source-plan-encrypted-transport`, base `main`. CI passed at `f43f54b6`: 685 client tests, full E2E 194 passed / 28 conditional skips; preview READY.
- PR #130 — atomic server expected-revision checks and distinct fail-closed conditional endpoint. Branch `feat/source-plan-server-cas`, base #129. CI passed at `4f6eb82d`: 354 server / 688 client tests, full E2E 194 passed / 28 conditional skips; preview READY. Backend code is not deployed to production.

## Current work

- PR #131 — branch `feat/source-plan-durable-send`, base #130: durable encrypted pending send, exact acknowledgement recovery after a lost response, preservation of local drafts on remote conflict, per-operation guards against delayed responses and re-pairing.
- Local validation: 699 client tests, typecheck/build and both real-API transport scenarios pass. The new recovery test crosses the fixed 1000-record API page boundary. Full CI and preview validation are pending until recorded in PR #131.
- Details and limitations: `protocol-v2-durable-send.md`.

## Next

1. Establish explicit server conditional-write capability before any protocol-floor upgrade.
2. Add explicit baseline/conflict reconciliation without dropping the pending local draft; then first-sync/deletion and coordinated legacy/source ordering.
3. Add restore epoch/replay protection, rollout gating and actual two-device browser flows before wiring the normal runner or enabling plan activation.
4. Continue patient confirmation, execution and consent-bound report flow, with Free/Plus gates and full clinical integration acceptance checks.

No merge to main or production update is authorized by this checkpoint. Product scope remains the agreed TZ; completed transport primitives do not imply the entire clinical flow is ready.
