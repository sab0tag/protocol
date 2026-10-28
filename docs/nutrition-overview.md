# Daily nutrition overview

Branch `feat/protocol-nutrition-overview`, based on main `1115980` (28 October 2026).

- Food tab opens `/food` — «Моє харчування». Direct `/meal/new` and `/meal/:id` retain the existing editor, three entry methods, secondary tools and save behavior.
- Date selection shares the existing Today date. The page is read-only: links open the original record editor. Viewing, changing dates and expanding composition do not write diary entries.
- Done meals alone contribute to the totals through `dayTotals`; planned/skipped meals retain literal states. Targets come from the selected day's active mode and observation policy; no default goal or total health score. Unknown goals paint no completion arc. A carb ceiling is a limit, never a target to fill.
- Estimated/unknown composition is explicit beside the summary and affected meals. A zero known subtotal does not claim the whole day has zero intake.
- Per-meal checks reuse `evaluate` with the candidate excluded, the previous seven days and selected date. Allergen, attention, incomplete and no-known-conflict presentations reuse `foodPlanStatus`. No active constraints means unconfigured, never a green safety claim. Reasons and a medical-safety caveat remain visible.
- Active restrictions/reasons are shown with links to the plan. Existing dishes and food assistant remain available; no synthetic pantry, preparation times or new recommendation engine are claimed.
- Keyboard/ARIA tab state is retained across the food hub, entry editor and dishes. Existing route ownership remains under `food.log`.

Checks at publication: 561 unit tests; production build/typecheck; focused nutrition/entry/naming browser scenarios (6 passed). Synthetic populated and empty captures at 320/1024 light/dark are inspected before publication. Full CI/preview are tracked in the PR.

Next: catalog/favorites/quick repeat polish and data-backed food suggestions. Do not claim the whole Protocol 2.0 scope is complete. No main merge, production deployment or personal data publication.
