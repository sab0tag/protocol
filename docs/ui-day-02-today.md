# UI-DAY-02 — Today execution screen

Depends on UI-DAY-01 (#167). Work started after UI-ARCH-00 (#165) completed its unit/build, server, acceptance-1, acceptance-2 and compatibility jobs successfully (run 41885601432). No main merge or production promotion is part of this change.

The Today screen now has a plain mint heading, date, active profile and scoped remaining-action count. Date selection is in an accessible native disclosure. The seven-day calendar retains recorded-day dots, week stepping, historical days and return to today. It scrolls within its own container on narrow devices so date targets stay at least 44 × 44 px.

The execution area contains the existing priority action and snooze/confirmation controls, followed by pending schedule rows, collapsible quantitative goals, and a separate collapsible outcome history. Duplicate progress tiles and the forest/motivational hero are removed. Goals use compact labeled tracks, real plan quantities and limits; there is no combined health/treatment score. Confirmed water and voluntary light-day records remain inspectable in history.

The active profile remains visible on Today. Personal greetings and optional daily phrases move to the profile directory. The existing per-profile preference, clock/midnight updates, isolation and cross-tab name updates are retained.

## Preservation boundaries

- Existing `dayFocus`, `buildChecklist`, `dayRhythm`, observation/feature policy and source-plan selectors still determine scheduling and visibility.
- Existing handlers retain time confirmation, unknown time, uncertainty, late completion, snoozing, explicit skip confirmation/reasons, undo, editing, deletion, meal confirmation, repeat yesterday, voice, symptom and light-day behavior.
- History labels distinguish completed, skipped and uncertain outcomes. A skipped action is not labeled completed; unknown times are shown as unknown. History can reopen the original entry sheet.
- The remaining counter is explicitly scoped to canonical discrete checklist actions (medication, workout and dinner deadline). Quantitative goals and ad-hoc records are excluded. The existing legacy schema cannot prove the planned origin of every completed meal, so no fabricated all-source fraction is introduced.
- No data schema, medical rule, report calculation, Free/Plus entitlement, clinic/QR access or sync protocol is changed. Existing report consent remains required.

## Verification

Client suite: 769/769 passed; TypeScript and production build passed. The compatibility regression run passed 33/33 browser cases. Acceptance checks passed 19 cases (one ordinary-build-only case intentionally skipped), including clinic → QR → reviewed patient plan, report consent, light-day lifecycle and skip reasons. Browser regression checks cover the intentional move of completed rows into history, cancellation/undo and skip reasons, profile isolation, date navigation, quick water actions, limits without invented percentages and offline reload. A responsive case checks all seven approved widths in both themes, disclosure keyboard operation, separate counter/goal behavior and calendar target sizes.

Remote CI and the protected preview must be verified on the exact published commit. UI-PLAN-01, UI-ACTION-01 and UI-RESULTS-01 remain separate stages.
