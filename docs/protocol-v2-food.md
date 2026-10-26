# Protocol 2.0 — Food UI slice

Base: `ui-ux/protocol-v2-import-review` (#18, `7ea6e0b`). Branch: `ui-ux/protocol-v2-food`.
This UI slice is independent of `feat/protocol-v2-explicit-import-times`; neither branch changes main.

## Result

- Shared Protocol card treatment for the food header, search, composition, totals and meal metadata.
- Search stays first and keeps its existing text/photo/keyboard-dictation behavior.
- Favorites show three entries initially and expand on demand. Frequent products are a collapsed disclosure; the full list remains available.
- An empty new meal offers up to three distinct completed meals, newest first. Planned, skipped, empty and future records are excluded. The selected date bounds history as well.
- Repeat identity retains full ingredient snapshots, amounts, cooking, units and manual nutrition; ingredient order alone does not create a second suggestion.
- A repeat copies composition into the current draft, preserving the current name/time/status. It creates no saved event until explicit confirmation. Current restriction and allergy checks run on the copied composition.
- Confirmation stays above the mobile tabs and shows the selected count. On narrow screens, quantity controls get the full row so the numeric value remains readable.
- No storage, API, sync, medication, calorie or restriction-rule changes. Previously recorded meals and favorite snapshots are not edited by repetition.

## Validation

- 378 client unit tests, TypeScript and production build passed.
- Focused meal, favorite, photo-label, dish and feedback scenarios passed.
- New browser scenarios cover three-item bounds, duplicate composition, excluded statuses/future dates, explicit save, current-plan checking, source-record immutability, compact favorites, draft reload and confirmation position.
- Visual review: 320 px light, 390 px dark, 1024 px light. A quantity field that was cramped at 320 px was expanded to a full mobile row and given a width assertion.
- Final full regression: **82/82 E2E passed** in 3.3 minutes. No remote publication or CI success is claimed for this branch yet.

## Remaining R3 work

A broader dish browser/filter design, richer ingredient editing and cross-input duplicate handling remain separate tasks. This slice provides recent-meal repetition and visual consistency without declaring the whole R3 release complete.
