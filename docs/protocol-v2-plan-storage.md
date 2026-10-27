# R5 expand-only storage preparation

Schema 11 adds `carePlans`, `carePlanItems` and `planMigrations`. Opening the app only creates empty stores: no startup, UI, notification or sync code calls the preparation command. Multi-plan writes remain unavailable until compatible sync/backup/restore and a flagged rollout are implemented.

`prepareLegacyPlanCore(db, personId)` verifies the fixed profile database, then creates the plan/items and retained snapshot in one IndexedDB transaction. It never clears or changes the old `main` plan, journal, source pieces, photos or review drafts. Existing identities are added, never overwritten. Failed item writes roll back the plan and marker as well.

A retry or a second tab uses the migration marker and returns `unchanged`, without changing prepared data. A changed legacy record returns `source_changed`, preserving both versions for later explicit reconciliation. Object key order does not count as a change. A missing plan does not create one. A missing prepared record or owner mismatch fails rather than reconstructing over existing data. A person-scoped read checks database ownership and parent/item integrity. This local check is not server authorization.

Compatibility regressions cover a native v10 database, the three independent v9 histories, older v10 Dexie code reopening the expanded database, repeated opening, failed-write rollback, two-connection concurrency and source change detection. The original clinical backup/sync formats remain unchanged; the new stores are not yet a user-writable source of clinical data.

Before enabling the model:

- Define vault/person ownership at the sync boundary: local profile ids are device-local and cannot become a server access claim. Encrypted per-person vaults and explicit same-profile connection must remain isolated.
- Include normalized records and snapshot/version recovery in compatible export/import, encrypted sync and restore. Source changes must require comparison instead of silently replacing another clinician's plan.
- Add a default-off rollout flag for consumers, with a safe return to the legacy journal. No occurrence or instruction is activated by a storage preparation call.

No new controls or chart changes are introduced here. Current UI validation is inherited from the tested parent; browser tests also open the native older schema and confirm its records survive while the normalized stores stay empty.
