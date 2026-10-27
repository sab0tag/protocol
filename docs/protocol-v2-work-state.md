# Protocol 2.0 — work state

Latest review: `docs/protocol-upgrade-review-2026-10-27.md`. The #23 checkpoint below is historical; current main is `9acb16f` and #22/#23 are merged.

Updated 2026-10-27. Continue autonomously through implementation, validation, PR, CI and preview. Owner authorized merging tested ready PRs into main on 27 October 2026. Continue through reviewed stages; do not deploy production separately without authorization.

## Base and PR stack

- Verified main: `0f3da33f5d691b292bd0ed202b4f9568f0b0cc94` (module-aware reminders).
- PR #22, `fix/protocol-day-order-labels`: top water action removed, timeline before summary, mock terminology. CI run 40436755987 passed; Vercel preview ready. This is the parent of the profile slice, not a main merge.
- `feat/protocol-family-profiles`: local family profiles and personal Today header. PR #23: https://github.com/sab0tag/protocol/pull/23. Base: `fix/protocol-day-order-labels`.

## Delivered profile behavior

- «Сім’я та профілі» in «Ще → Налаштування», also reachable from the Today greeting and current-profile label.
- Create and rename local profiles, choose self/child/relative, switch profiles, show active person throughout the app. Initial avatars use initials; no fabricated portraits or family details.
- The original `protocol` database and legacy storage keys remain assigned to the initial profile. Additional people get a separate database, empty plan/onboarding, independent sync credentials, consent flags, view settings, shopping checks and recoverable drafts. A private `seed.local.ts` is never applied to another person.
- Switching reloads the page; the database identity stays fixed for in-flight requests. Other open tabs reload when the directory changes. Damaged directories are rejected before seeding or syncing, not silently overwritten.
- Local-time greeting: 05–11 morning, 12–17 afternoon, 18–22 evening, otherwise night. Name stays exactly as entered; grammatical inflection is not guessed. Greeting/time refresh on timer and when the page resumes.
- 31 supportive phrases rotate by local calendar date, consistently across reloads and DST. These are encouragement, not invented health achievements or clinical advice.
- The current push worker is bound to the original database. Additional profiles explicitly show that push reminders are not yet available; they keep the local day schedule. Their sync must not unsubscribe the original profile. Opening an original-profile notification restores that profile before navigation.

## Boundaries and remaining scope

Local profiles are not accounts or access control: people sharing a browser can switch them. Family invitations, caregiver permissions and remote shared access are not implemented and have no placeholder actions. Push delivery for additional people needs a profile-aware server/worker protocol before enabling it.

Profile names/directory are local device settings, not part of the existing clinical backup or encrypted sync format. Existing data import/export and sync apply to the active person's database. Whole-family backup/restore remains separate work; do not claim it already exists.

The broader Protocol 2.0 TZ remains open. The next concrete import slice is requiring explicit reviewed medication clock times, preserving all current module preference and forest UI behavior. Local preparation commit `dd7a7eb` is on an obsolete base and must be integrated and revalidated, not published unchanged.

Still outstanding from document onboarding: persisted recoverable review drafts, field-level verification, PDF handling, durable document provenance, deduplication/version comparison and multi-plan activation. Multi-plan/source ownership and caregiver authorization need explicit domain contracts. The independent module/Light Day stack must be checked against current open PRs before incorporating it.

## Validation

- 460 client unit tests and 66 server unit tests passed; both typechecks and production build passed.
- Full browser regression: 96 passed / 3 conditional skips. Additional stronger profile-write isolation, original-record preservation and live greeting/midnight scenarios: 2/2 passed.
- Profiles and personalized Today visually checked at 320 and 1024 px, light/dark. No horizontal overflow. Synthetic names only; no user screenshots published.
- The module-policy-enabled browser suite also passed (6/6).
- PR #23 CI is running. Vercel deployment succeeded. No main merge or production update.
- Next: resolve any remote CI failures, then integrate the explicit-time import slice on this tested stack.

## Upgrade review — current checkpoint

- Current base: main `9acb16f2434a9c8e7b88c4c0e5662a94b647d537`, including #28–#32 shared artwork, meal tabs/favorites, theme preference and weekly Progress summary.
- Branch `fix/theme-controls-and-meal-tabs` fixes category-local meal deduplication and theme-dependent checkbox/switch/shadow styles. New regressions failed on original main; updated source retains the new artwork and layout.
- 483 client unit tests, typecheck/build and browser regression 106 passed / 3 conditional skips. Final focused regressions: 2/2; module-policy-enabled checks: 6/6. PR #34: https://github.com/sab0tag/protocol/pull/34. Code commit 82725b9 passed remote CI run 40565385637 (check, server, e2e); Vercel preview ready at https://protocol-git-fix-theme-controls-and-meal-tabs-beyondthesignal.vercel.app. Subsequent documentation clarification does not change application code.
- #24–#27 remain a separate unmerged stack. Integration requires a forward IndexedDB migration above v9 preserving both `profile` and `reviewDrafts`, plus adapting Progress without losing the weekly summary. Do not resolve competing v9 definitions by dropping either store. Dexie can patch missing stores at the same declared version; an isolated experiment confirmed this, so no current-main data-loss claim is made.
- Next: finish this fix's CI/preview, then adapt the old import/quality/preference stack to the current main before proceeding with R5/R6. No main merge or production update from this review.

## Continuation after upgrade review

- Owner authorized main merges. #34 merged as `69cb083`; #33 rings merged as `5a9d65f`, the current base for this slice. Both PR heads passed CI before merging.
- #24 explicit medication times adapted to current main, preserving current photography, theme controls, meal tabs and weekly rings. 494 client unit tests and 66 server tests passed; production build passed. Full browser regression currently running; remote CI/preview to be recorded in PR #24.
- #25 recovery is being adapted separately with schema v10. Preserve both independent v9 stores (`profile` and `reviewDrafts`), including in the compatibility v9 declaration because Dexie revisits it during upgrade. The new migration test caught draft loss with the old photo-only v9 declaration; the corrected union passes all three v9 histories and a reopen.
- #26 weight review and #27 motivation preferences must retain the latest Progress rings, line chart and section assets. Next: complete #24 browser/CI/preview; publish and verify adapted #25, then #26/#27. R5/R6 architecture remains open in the acceptance map.
