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
