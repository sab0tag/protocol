# UI-ACTION-01 — shared action detail

Stage 6 of the redesign sequence in `ui-arch-00-redesign-audit.md`: reuse the existing action handlers in one detail layout. Keep the stale-state checks, skip confirmation, undo and history.

## What changes

- **One detail layout** (`ActionDetail`). A Today record opens a sheet with the existing preview: time, outcome and the move history from #164. A labelled group «Дії із записом» holds the existing actions in their existing order and conditions: done or resolve-uncertain, skip (with its confirmation and optional reason), back to plan, move, edit, pin, delete.
- **The sheet shows the record as it is now.** The sheet subscribes to the record by id. If a synced device or another tab changes it while the sheet is open, the sheet shows the current version with a notice, and the actions follow the current outcome. If the record is deleted, the sheet says so and offers no actions.
- **Stale-safe writes** (`entryActions.ts`). Status changes, skips (including a reason typed in a dialog that has since gone stale) and deletions use one transaction: read, compare with what the person saw, then write. A stale view writes nothing and says «Нічого не збережено». Before, it silently overwrote the newer record. Two submissions of one view write once.
- **Conditional undo.** Undo restores the earlier record only while nothing has happened to it since. It never overwrites a later edit, never resurrects a later deletion and never replaces a recreated record. A refusal is said plainly.
- Record comparison ignores key order. This removes a spurious «changed» after a sync round-trip, and meal moves (#164) now use the same comparison.

## What does not change

Outcome semantics are the same: a reason only for a skip; an earlier reason, adherence and an uncertain mark's time do not carry over. Medication time questions, uncertainty resolution, meal confirmation, menus, storage schema, sync, reports and module visibility also stay as they were. No new clinical decision is made or suggested.

## Verification

- Unit: `entryActions.test.ts` covers equality, outcome rules, stale refusal, deletion, conditional undo and double submission. Meal-schedule tests still pass.
- Browser: `actionDetail.spec.ts` uses two tabs as a stand-in for a synced device. It covers the live sheet after a change elsewhere, the deleted state, a stale skip writing nothing, and an undo refused after a later change. Both tests fail on the previous code.
- Regression: skip lifecycle, day, meal move, medication adherence, Today, sync and return-after-break pass in acceptance and compatibility builds.
