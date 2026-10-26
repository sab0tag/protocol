# Protocol 2.0 implementation checkpoint — 2026-10-26

## Branches and sources

- Product/UX/Architecture TZ: `Protocol_2_0_Product_UX_Architecture_TZ(1).docx`, dated 2026-10-26.
- UI stack: PRs #11 → #12 → #13 → #14 → #15 → #16.
- This pass starts from #16 at `6fb13af` and merges `ui-ux/plan-screen-separation` through `677b64f`.
- `ui-ux/protocol-v2-latest-integration`: latest screen behavior plus E2E repairs; intended base is #16's `test/protocol-v2-today-regression`.
- `ui-ux/protocol-v2-import-review`: photo-review slice on top of that integration branch.
- Main remains at `076d49d`. The module/Light Day stack (#2–#9) is independent and is not included in this UI branch. Do not treat the UI branch as an integrated release of both stacks.

## Delivered in this pass

1. Reconciled latest screen-separation changes with the new timeline card: yesterday's food repeat, four quick actions, empty-state rules including anytime medicines, asymmetric due-now confirmation window.
2. Aligned the Node E2E timezone with the browser's Europe/Kyiv zone. Updated obsolete More-group expectations. The actual worker's notification content is captured at `showNotification`; OS notification delivery still needs a device check.
3. Added photo → redact → review steps, grouped review cards, source/confidence information, an explicit selected count, and confirmation that stays above mobile tabs.
4. Retained checked draft lines on a failed IndexedDB write, blocked duplicate submission while saving, and kept retry available. The fault test aborts an actual plan/pieces transaction, then verifies a single successful retry.
5. Reviewed 320 px light, 390 px dark, and 1024 px light layouts. The E2E scenario checks overflow and confirmation position as well as the save result.

## Scope against the TZ

This is an incremental R1/R2 visual and R7 review-UX slice. It does **not** complete R7 or introduce multi-plan storage.

- Existing import domain behavior is preserved, including clearly labelled suggested times from frequency. The TZ's stricter rule for absent times requires a separate domain change and updated acceptance tests; it is not satisfied by this visual slice.
- Draft state survives a failed save in the open page; it is not persisted across reloads.
- PDF input, durable full-document provenance, field-by-field editing/verification, document deduplication/version comparison, and multi-plan activation remain outstanding.
- No profile/admin/caregiver storage or permissions are introduced. No identifiable clinical dashboard is added.

## Next implementation boundary

Before declaring document onboarding complete, specify and implement critical-field verification in the domain: explicit dose/unit/frequency/time/date decisions, absent-time behavior without invented defaults, and persisted recoverable drafts. Keep schema/migration and UI work reviewable separately. Multi-plan IDs, source ownership, backup/sync compatibility and conflict rules must be designed before changing the single-plan `main` record.

## Validation

- 378 client unit tests, 58 server unit tests, both typechecks and production build passed locally.
- The import/browser fault scenario and existing photo/onboarding scenarios passed locally.
- Full E2E suite: **80/80 passed** in 3.2 minutes on the final code.
- Local browser uses Chromium 153. OS push delivery, real camera input and live OCR/model quality are outside these stubbed browser checks.
- No main merge, production deployment, or remote CI success for these new commits is claimed.
