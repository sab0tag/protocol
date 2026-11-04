# UI-DAY-01 — read-only day presentation

Depends on UI-ARCH-01 (#166). UI-DAY-02 has not started; the architecture-audit completion gate in #165 remains in place.

`presentDay` is a pure adapter over `buildChecklist`, `visibleChecklist`, `dayRhythm`, `dayFocus`, `entryVisible` and `adherenceState`. The existing Day screen uses its checklist and rhythm outputs; write handlers, dialogs, reminder/snooze commands, prescriptions and storage schemas are unchanged.

Outputs preserve:

- The feature-filtered day entries and the existing light-day timeline suppression.
- Canonical checklist and rhythm, including untimed doses and the existing meal deadline.
- Existing priority/snooze behavior and historical/future day boundaries. A late dose is not advice to take it; no clinical severity is inferred from the medication category.
- Quantitative water/mode goals separately from discrete checklist execution.
- Confirmed records, explicit skips/reasons, uncertainty, late completion, unknown times and source references. Recorded facts remain available separately on light days.

The input entries remain scoped by the existing day query. The adapter does not reinterpret stored timezone boundaries, rewrite provenance, merge source plans or mutate input order.

## Counter boundary

`execution` counts only canonical checklist actions; it excludes quantitative goals and ad-hoc food/water/notes. Pending meal entries remain in the timeline. Legacy completed meals do not always retain proof that they were planned (a confirmation at the original time can omit `plannedAt`), so the adapter does **not** invent a complete mandatory-task denominator from arbitrary records. UI-DAY-02 must label each counter according to its actual scope. A true all-source mandatory counter requires explicit plan provenance, not a cosmetic relabel of existing totals.

## Verification

- Seven new regression cases cover selector equivalence, separate goals, skip/late/uncertain states, module filtering, light-day history, selected-day boundaries and snooze/source/input preservation.
- Full client suite: 769/769 passed; TypeScript/production build passed.
- Existing Day/medication/skip/return-after-break browser scenarios: 25 passed initially. One obsolete hero-brand assertion was corrected in #166 and rerun; one push-support assertion is limited by the local headless-shell browser and remains covered by ordinary Chromium CI.
- Remote CI and preview results must be checked on this PR's exact head before marking it complete.

No visual redesign, new clinical rule, automated completion or data migration is included.
