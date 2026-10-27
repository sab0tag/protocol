# Protocol upgrade review — 27 October 2026

## Reviewed base

- Started at main `b01cf6b` (#30: explicit theme preferences). #28/#29/#31 add shared surfaces, section and food photography, meal-category tabs/favorites and assistant layout.
- Main advanced during review to `9acb16f` (#32: the existing seven-day summary on Progress). The fix branch was fast-forwarded to that base before its final regression.
- Representative Today, food editor, settings and Progress captures were inspected. The existing browser matrix covers 41 screens at 320/390/768/1024 px in both themes; geometry checks are not a full pixel-by-pixel mockup audit.

## Confirmed regressions and fixes

1. **Meal category isolation:** composition deduplication ran before category grouping. The same food recorded as breakfast and a more recent snack disappeared from the breakfast tab. Identity now includes the meal category, preserving duplicate removal inside each tab and all composition/amount details. The regression checks both tabs and the repeated draft's grams.
2. **Explicit theme/control mismatch:** the palette honored the selected theme, but checkbox glyphs, switch thumbs and card shadows still followed the device media query. Semantic control tokens now follow the selected theme; device dark styles apply only while following the device. The regression compares settled control paint across all four device/selected-theme combinations.

Both regressions were reproduced on the original main before source fixes. Section/food assets, the updated greeting copy, the compact layout and weekly-summary behavior are retained.

## Integration finding — not a current-main data-loss claim

Main uses IndexedDB schema 9 for the local `profile` photo table. The older, unmerged review-recovery stack (#25 onward) independently uses schema 9 for `reviewDrafts`. A merge check of current main with the weight-review branch reports conflicts in `src/data/db.ts`, `src/screens/Progress.tsx` and the module migration test.

Before integrating that stack, add a new forward migration above version 9 that preserves both tables, and test upgrades from both v9 histories. Do not resolve the source conflict by dropping either table. Dexie 4.4.6 can patch missing stores at the same declared version: an isolated fake-indexeddb experiment from each v9 history created both stores at native version 91. Therefore this is an integration/test requirement, not evidence that the current main loses data; prefer an explicit forward version and test retained records from both histories. Preserve the new photos, weekly summary and actual latest UI when adapting the old PRs. This review fix does not merge those branches or change the database schema.

## Validation

- Original reviewed main: 483 client unit tests, production build and 104 browser tests passed; 3 conditional browser skips.
- Focused new regression plus food scenarios: 6 passed after fixes.
- Updated base `9acb16f`: 483 client unit tests, typecheck and production build passed. Full browser regression: 106 passed / 3 conditional skips. Final theme/category regression checks: 2/2 passed. Module-policy-enabled scenarios: 6/6 passed; remote CI/preview will be recorded in the PR. No main merge or production update is performed by this review.
