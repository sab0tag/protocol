# Recoverable document review

Local-only `reviewDrafts` table, schema 10. The compatibility definition of v9 includes both `profile` and `reviewDrafts`: Dexie revisits that definition during upgrade, so retaining their union prevents dropping drafts created by the older review branch. Regression tests cover photo-only, draft-only and combined v9 histories, including retained plan, entry and source-fragment records and a second reopen. Existing tables/rows and the encrypted clinical sync/backup format are unchanged. The table belongs to the active profile's database and is never included in vault sync or clinical JSON export.

A review stores parsed lines, explicitly edited values, source text, note and cropped/redacted source fragments. Raw camera pages and full documents are not added by this slice. Complete document provenance and PDF import remain open R7 work.

After a reload or navigation, the person can continue or explicitly delete the draft. Resuming clears activation/skip/close confirmations: all decisions must be checked again against the current plan. «Зберегти на потім» pauses without activating anything. A failed autosave says so and offers retry; it must never claim the latest edits were persisted.

Each snapshot has an opaque revision. A stale tab cannot replace or delete a newer snapshot. Successful activation checks the original plan projection and consumes the expected draft revision in the same transaction as plan/piece changes. If any write aborts, the draft and previous plan remain available for retry. The UI also retains the in-memory review when activation fails.

The original saved plan is not a multi-plan model. Comparing or overwriting source plans across clinicians remains outside this change. Confirmation after recovery is not a replacement for the remaining field-by-field verification of dose/unit/frequency/duration.
