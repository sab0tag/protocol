# Protocol 2.0 — current work state

Updated 27 October 2026. Owner authorized merging tested ready PRs into main in this session. Continue code → checks/fixes → PR → CI → preview → next boundary. Do not perform separate production operations without authorization. Publish only code/assets/synthetic fixtures, never private screenshots, real medical records or secrets.

## Current integration

| PR | Scope | Verified state |
| --- | --- | --- |
| #33 | Accessible weekly Progress rings | Merged `5a9d65f`; CI passed; independently checked at 320/390/768/1024 light/dark |
| #34 | Explicit-theme controls and category-local meal deduplication | Merged `69cb083`; CI passed including final docs commit |
| #24 | Explicit medication times; no inferred clock values | Adapted and merged `4225134`; CI run 40572857062 passed |
| #25 | Recoverable local document review and revision guards | Adapted and merged `a4f2944`; CI run 40573406988 passed |
| #26 | Weight input review, correction history, chart/report exclusion | Merged `89ef1dc`; CI run 40573597702 passed |
| #27 | Optional daily phrase and immediate cross-tab name updates | Merged `41294f6`; CI run 40573800588 passed |

PR links: https://github.com/sab0tag/protocol/pull/24 through /27, /33 and /34. Refreshed heads preserve current section/food photos, compact header, greeting copy, meal tabs, explicit themes and weekly rings. Removed global profile strip is not reintroduced.

Latest full-stack preview: https://protocol-git-feat-protocol-profile-motiv-3c92c7-beyondthesignal.vercel.app (Vercel ready). Preview status is not a claim of manually testing the deployed URL; browser regression ran against the built app locally.

## Validation and resolved failures

- Adapted #24: 494 client tests, 66 server tests and build passed. Full local browser run: 106 passed, 3 conditional skips, one photo-preparation timeout during concurrent resource exhaustion. The unchanged scenario passed separately in 10.7s; refreshed remote CI passed the full suite. No timeout/assertion was weakened.
- Adapted #25: 501 client tests, production build and server typecheck passed; focused browser import/recovery/retry/concurrency suite 9/9.
- Adapted #26: 516 client tests, build, 3 focused browser cases passed. Fixed the previous Progress fixture to write to the demo database and assert exact seeded values.
- Complete adapted #27 stack: 517 client tests, build; 114 browser tests passed / 3 conditional skips. Module-policy-enabled browser checks 6/6. Mobile/desktop light/dark captures inspected.
- Original concurrent browser startup exit 137 was environment memory exhaustion; rerun passed after reducing local unit worker concurrency. This was not an application assertion failure.
- Migration test exposed draft loss when v10 followed a photo-only v9 declaration. The compatibility v9 definition now retains the union of `profile` and `reviewDrafts`. All three v9 histories (photo/draft/both) retain plan, entry, source pieces and existing local records across upgrade and reopen. New stores are not added to existing sync/clinical backup formats.

## R5 first boundary — source-plan domain contracts

Branch `feat/protocol-plan-core`, stacked on the adapted #27 tree. Adds deterministic lossless expansion of the current `main` plan into separate plan/item identities and a retained legacy snapshot. No storage change, activation, schedule generation or UI rollout yet.

- Explicit person/plan ownership, version and lifecycle state; each item's source remains attached.
- One legacy record remains one plan of unknown authorship. No invented clinician, dose/strength/unit, missing clock, validity date or verified status.
- Two parallel source plans retain their independent instructions and versions. Person-scoped projections return detached objects; identity collisions and cross-owner joins fail rather than dropping records.
- Domain regressions 5/5; full client suite 522 passed before the final snapshot-detachment refinement, then focused 5/5 and build/typecheck passed on the final code. CI/preview will be recorded in the PR.

See `protocol-v2-plan-core.md` for contracts/boundaries and `protocol-v2-roadmap.md` for the R0–R14 acceptance map. This is the first part of R5, not a claim that R5/R6 are finished.

## Next actions

1. #26/#27 are merged after green CI. Core PR #35 passed CI run 40574749672 and merged as `08a0908`.
2. Complete the core PR CI/preview and review; merge only if green.
3. Implement expand-only transactional plan/item storage migration and recovery. Preserve v9/v10 local tables and the original journal; prove idempotence and rollback.
4. Add compatible encrypted sync, backup/import and restore before enabling multi-plan writes. New writable data must not silently disappear from backups.
5. Add flagged catalog/Today consumers, source conflict/duplicate review and verified activation. Keep occurrence history/identities and never create retroactive obligations.

## Remaining product boundaries

Local profiles are not accounts or caregiver permissions. Additional-profile push, family backup/restore, invitations/scopes/consent/audit and remote authorization remain open. PDF/source document lifecycle and full critical-field verification remain open R7 work. R0/R1 full audit/accessibility, R5/R6 separate plans, R9/R10 caregiver access and later reporting/assistant/pilot releases remain subject to their acceptance criteria. Do not claim the full TZ is complete.

## R5 second boundary — storage preparation

Branch `feat/protocol-plan-storage`, parent `feat/protocol-plan-core` (PR #35, head `6c55cac`). Schema 11 expands the database with empty plan/item/migration stores; preparation is not called by app startup or UI. The old journal remains authoritative.

- Transactional preparation preserves the original plan and retained snapshot, rolls back on failure, rejects wrong profile databases and detects stale source data or partial/corrupt preparation. Concurrent connections serialize rather than duplicate instructions.
- Focused storage/migration/module regressions 27 passed; additional old-code reopening test 6/6. Production build/typecheck passed before that test-only refinement. Native Chromium v10 upgrade + recovery/profile/theme regressions 7/7 passed. Full client suite 528 passed; final old-code reopen refinement passed the 6 focused storage tests and final build. CI/preview will be recorded in the PR.
- Native browser test verifies original plan, photo, review and weights survive schema 11 while normalized stores remain empty. No new UI or clinical activation is exposed.
- Next: finish core/storage CI, then implement compatible ownership-aware sync/backup/import/restore before flagged consumers. See `protocol-v2-plan-storage.md` for scope and constraints.

## R5 third boundary — source-plan JSON recovery

Branch `feat/protocol-plan-backup`, stacked on storage PR #36 (head `dad4cc8`). Normalized records remain non-authoritative preparation data; no multi-plan editor or Today consumer is enabled.

- Ordinary journals keep format 2. Prepared plans require format 3, with plans/items/recovery snapshots exported in a consistent transaction. Explicit one-person restore rebinds device-local ownership without changing source ids; invalid/mixed-owner graphs fail before writes. Old-format replacement cannot drop existing prepared plans. A late failure rolls back both representations.
- Retained older identity format is supported; new legacy ids are owner-independent because local profile ids differ between devices. This is not cross-person sharing or server authorization.
- 534 client tests, build/typecheck and 55 focused backup/domain/storage/legacy cases passed. Browser backup/upgrade/preference cases 3/3 passed. Confirmation visually checked 320/1024 light/dark; no personal screenshots or medical records published.
- Next: complete #36/#37 CI/review; implement encrypted sync compatibility and old-client write protection before enabling live multi-plan consumers. New source data must never be silently omitted by a claimed complete backup/sync.

## R5 fourth boundary — old-client server gate

Branch `feat/protocol-sync-write-gate`, stacked on backup PR #37. API adds a persistent authenticated per-vault minimum protocol, default 1. The current client still advertises 1. Only an explicit capable-client request opts a vault into 2; no startup/UI code does so.

- Opted-in vaults reject old record reads/writes and stale reminder/policy submissions before advancing cursors or changing records. Transition clears old queued schedules atomically, preserves ciphertext/history/preferences, and protects fresh schedules from obsolete asynchronous push snapshots.
- 73 server tests, server typecheck; 534 client tests and build/typecheck passed. Three focused Chromium sync/backup cases passed, including actual server opt-in with an unchanged old client's cursor/ciphertext and an upgrade message.
- Next deployment boundary: independent Hetzner API container, not Vercel. No server deployment or real-vault opt-in performed. Deploy only with the owner's separate production command; keep default floor 1. See `protocol-v2-sync-protocol.md` for the concrete rollout/rollback sequence.
- Normalized encrypted transport and conflict/version recovery remain to implement before protocol 2 is advertised by a real client or live multi-plan consumers are enabled.

## Integration blocker / latest checkpoint

- #35 merged `08a0908` after CI run 40574749672 passed. #36 merged `62d912c` after CI run 40575971243 passed.
- #37 head `181fe016989bd37c4abb0ea2612973cea98ab473` passed all CI jobs (run 40577370600), review threads empty, marked ready. Automatic approval review rejected its main merge, stating that a separate main-merge command was missing, despite the owner's current instruction authorizing needed merges. No workaround/alternate merge path is used. PR remains open and ready pending explicit resolution of that rejection.
- The sync-gate branch is published as a separate PR stacked on #37; it can be reviewed and checked while the merge is blocked. Do not claim either #37 or the gate is merged. No Hetzner deployment or real-vault upgrade has occurred.


## Conflict resolution: calm polish on current main (28 October 2026)

Original #44 is dirty against main after #39/#41. Integration branch `integration/calm-polish-on-main` starts from current main and ports the nine implementation/test files from #44, retaining current main history and its #39/#41 changes. Original docs history is preserved and this note appended instead of replacing it. Full CI and visual preview are required before merge; no production deployment or patient data is authorized. Original #44 remains open for historical review; merge the integration PR only after verification.


### Integration #53 CI regression triage (28 Oct)
First remote CI: check and server passed; e2e failed in four cases. Fixed genuine Today ordering regression (example-data warning now before schedule); restored missing localized sync client-upgrade explanation while retaining protocol refusal; disambiguated storage test's page-level h1 from new Today summary h2 without weakening visibility assertion. Dish-list model-mock scenario returned failed instead of check; cause still under investigation, not bypassed. Re-run CI required. Assistant #52 second pass failed because prompt chips remained 154px from context; moved chips immediately after context in commit f9c7a194; subsequent CI passed. No merges until integration checks green.


### Food 2.0 integration after #53 (28 Oct 2026)
Original #47 was stacked on #44 and conflicts with current main. Branch `integration/food-on-main` ports food-only implementation, domain, translations, warning styles, and focused tests onto merged #53. Existing Today/sync fixes and tests are retained. Original #47 is not to be merged directly. Full CI, E2E and preview review are required before merge. No patient data or production authorization.

## Daily nutrition hub (28 October 2026)

Current base `1115980` already includes Food/Wellbeing/Progress/Assistant integration and the latest prescription-clock, photo-consent and report-outcome fixes. Original #44/#47 are historical branches and are not merged directly.

`feat/protocol-nutrition-overview` adds `/food` («Моє харчування») as the food tab: date-scoped actual totals, source targets, preserved planned/skipped outcomes, expandable meal composition and original edit links, visible restriction reasons and limited rule-check claims. Existing entry methods/editor remain unchanged. Unknown/estimated composition cannot silently look complete. No new journal writes, fabricated targets, pantry/preparation data or overall score. See `nutrition-overview.md` for checks and the remaining catalog/recommendation scope. Full CI and preview status live in the PR; main/production remain unchanged.

Marketing #48 was refreshed by merging current main into its own branch. Its 8 focused browser tests pass again. Published visual verification remains blocked by Vercel authentication in the available browser; no protection settings changed.
## Sheet keyboard integration (28 October 2026)

PR #66 refreshed on main `d1a56f7`, preserving the catalog, lab-correction, AI routing and clinic work already merged there. The Sheet focus lifecycle keeps the background inert, wraps native Tab navigation, preserves editing focus across callback changes and restores the original opener through sheet replacement.

The first CI run had four failing new browser scenarios: the backdrop click did not wait for the reopened dialog; the symptom save button has a different disabled label; the medicine scenario searched an obsolete accessible name; the add chooser was requested from an empty day where it is deliberately absent. Updated the fixtures and locators without changing the product's names, empty-state behavior, timeouts or focus assertions. Browser coverage now exercises both 320px and 1024px layouts, plus current lab/import interactions. The standard CI browser configuration is unchanged.

Baseline on the refreshed tree: 601 client and 141 server unit tests, client production build and both typechecks passed. Final browser/CI results are recorded in #66; merge only after green checks. Next independent integration: #65 daily nutrition hub, followed by onboarding #60 and the workout #45 → #46 → #49 stack. Existing production access and real data remain untouched.


### Nutrition integration refinement
Refreshed #65 on main d1a56f7 plus #66. Preserve estimated parent recipes as incomplete even if descendants resolve to known foods; do not show a confirmed allergen or clear result from an estimated parent. New domain and browser regressions exercise this case. Existing actual totals, date modes, unknown-goal behavior, catalog filters/favorites and explicit save remain intact. Focused nutrition/catalog/entry browser checks: 9 passed before Sheet integration; final combined checks/CI are recorded in the PR.

## First-run value and synthetic preview (28 October 2026)

PR #60 refreshed on main plus #65/#66. First run explains photo → verification → daily plan and shows three explicitly fictional examples of supported medication reminders, restriction checks and reports. The preview does not write prescriptions or entries, call AI, or add another required step. Actual OCR consent, redaction, per-line verification, manual entry, skip and isolated demo remain unchanged. No unsupported follow-up reminder or broad doctor-data-access claim is introduced. Copy remains in the Ukrainian dictionary; decorative icons are hidden from assistive technology.

598 client tests and build/typecheck passed before combining the already checked #65/#66 changes; 16 focused browser scenarios passed, including new zero-record/zero-AI preview assertions at 320/1024px, actual OCR confirmation, skipped onboarding, demo isolation and import recovery. Visual inspection prompted a shorter preview so the photo action stays in the first mobile viewport; the final integration run asserts that. Merge order: #66 → #65 → #60. Final CI/combined regression evidence is recorded in #60; separate production operations remain out of scope.
