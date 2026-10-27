# Protocol 2.0 — release acceptance map

Source: `Protocol_2_0_Product_UX_Architecture_TZ(1).docx`, 26 October 2026, read against the current repository on 27 October. Latest owner corrections override mock ordering: timeline before summary, no water action under the top quick tiles, shared Ukrainian terminology.

This is an acceptance map, not a claim that complete releases have shipped. Repository checkpoints are in `protocol-v2-work-state.md`.

| Release | Required outcome | Current boundary |
| --- | --- | --- |
| R0 baseline | Route/storage/API inventory, threat model, reliable regression | Existing baseline/CI; current architecture still needs full review |
| R1 design | Shared tokens/components, both themes, accessibility, loading/error/offline | Woodland system across working screens; continued visual QA required |
| R2 Today | Adaptive action feed, nearest action, honest statuses | Working single-plan Today; latest ordering/labels in #22 |
| R3 Food | Fast repeat, favorites, editor, deduplication, sticky save | Current compact entry/3 recent meals; no claim of all acceptance cases |
| R4 quality | Invalid dates/units/weight, anomalous values quarantined until reviewed | Weight aggregation and editing still need the explicit quarantine slice |
| R5 core | Separate plans/items, migration, versions, status and provenance | Legacy single `main` plan; source plans must never be merged into one instruction |
| R6 plan UX | Parallel plans, clinician filter, unified feed, conflicts/archive | Not implemented; duplicates must not create double obligations |
| R7 documents | Photo/PDF, recoverable OCR draft, field verification before activation | Photo review works; explicit-time follow-up under validation; PDF, durable draft and full verification remain |
| R8 adherence | Reasons, unknown vs missed, gentle reminders | Existing explicit status/reminder behavior; complete intelligence not claimed |
| R9 access | Profiles, invitations, consent, server scopes and access audit | #23 provides local profiles only; no shared account permissions |
| R10 family | Children/older relatives, accessibility, delegation and immediate revocation | Local relationship labels only; remote delegation remains open |
| R11 reports | Follow-up, labs, PDF, period/source/completeness | Existing reports; per-plan provenance/PDF flow requires further work |
| R12 assistant | Context actions, record links, uncertainty, consent | Existing assistant; cannot autonomously change medical instructions |
| R13 reliability | Offline queue, sync/export/delete, recovery, security audit | Existing encrypted vault/backup; new models need compatibility/recovery tests |
| R14 pilot | Free/Plus, cost limits, payments, consented pilot metrics | Existing pilot/limits are not a complete commercial release |

## Fixed architecture constraints

- Separate plans share one computed Today feed, preserving the source of every action. Different clinicians' source instructions never silently overwrite one another.
- Potential duplicates/conflicts require review with the clinician. AI does not resolve medical conflicts or choose a dose/time.
- Person ownership applies to every record. Local profile switching is not authorization. Remote caregiver access requires server-side scopes, consent, audit and immediate revocation.
- Unknown is different from missed. No clinical success, obligation or missed dose is invented from an absent record.
- Document activation requires human verification. Missing clock values stay missing. Repeat imports need comparison/versioning rather than silent duplication.
- Schema changes follow expand/migrate/contract behind flags when changing existing semantics. Keep migration, API and UI boundaries reviewable.
- Motivational messages are localized, supportive and optional. Per-profile opt-out remains to be added to the initial daily-phrase implementation.

Critical path: R0 → R1 → R5 → R6 → R7 → R9 → R10. R2/R3/R4 can progress after the visual foundation. Reporting and assistant expansion follow stable plans; commercial rollout follows privacy/reliability work.
