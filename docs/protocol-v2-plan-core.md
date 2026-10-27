# R5 source-plan core — first boundary

This is the domain-contract/legacy-expansion slice, not completion of R5 or R6. The authoritative product specification is `Protocol_2_0_Product_UX_Architecture_TZ(1).docx`, read 27 October 2026. Follow-up boundaries are transactional storage migration, sync/backup compatibility, then catalog/Today consumers behind a rollout flag.

## Delivered contract

- Source plans have independent ids, person ownership, version, lifecycle state, optional clinician/date metadata and a source reference. Items belong to exactly one plan for exactly one person.
- One legacy `main` record expands into one source plan, not inferred clinician plans. Existing free-text source labels are retained per item; clinician, validity dates, dose/strength/unit and missing clocks are not inferred.
- Prescription, constraint, target, temporary-mode and follow-up payloads retain the current typed legacy structures. Diet-reference annotations remain target provenance, not a new instruction. A full cloned legacy snapshot retains remaining journal metadata and unknown extension fields for the later migration.
- New legacy plan ids are independent of device-local profile ids for portability; retained existing ids remain supported. Item ids are deterministic JSON tuples, with a category namespace so a prescription and constraint may retain equal legacy ids. Repeating the conversion produces the same identities; duplicate identities fail rather than discarding a row.
- A person-scoped read projection preserves both plans, including same-named instructions and all lifecycle states. It does not activate a draft, resolve a conflict, create a schedule occurrence, infer missed actions or grant remote authorization. Returned objects are detached from the source catalog.

## Next boundaries

1. Add expand-only stores and an idempotent transactional migration that keeps the existing journal intact. A malformed legacy record must retain a recovery path instead of partially moving data.
2. Define source-plan versions/conflicts across encrypted sync, import/export and restore. Do not enable a writable multi-plan UI while a backup can omit its records. Existing `profile`/`reviewDrafts` v9 compatibility and v10 data must survive.
3. Introduce feature-flagged read consumers and catalog UI, then explicit activation/verification and computed Today projection. Reconcile duplicate source instructions before they produce double obligations. Keep provenance and existing occurrence identities/history; no retroactive obligations.

The current app, database schema, backup format, Today feed and notifications continue using the existing model. No new UI controls or clinical behavior are exposed by this boundary.

## Validation

Domain regressions exercise lossless deterministic expansion, no inferred medical fields, two parallel source plans with distinct versions, source retention, detached projections, cross-person colliding ids, lifecycle preservation and rejection of identity collisions. Production build/typecheck must pass before publishing. Follow-up storage and UI changes require migration, sync, browser and visual checks of their own.
