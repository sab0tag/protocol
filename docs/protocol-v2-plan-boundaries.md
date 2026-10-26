# Protocol 2.0 — Plan screen boundaries (architecture contract)

Status: proposal, independent of the stacked module PRs (#2–#9).

## Compatibility
- The intended `ui-ux/plan-screen-separation` branch was not present on GitHub at the time of writing. Reconcile its implementation before changing plan-screen code.
- Keep current `main` behavior intact; no schema migration, routing change, or production flag in this PR.
- Module preferences and Light Day must be respected in every view. Never re-enable a disabled module implicitly.

## Screen responsibilities

| Surface | Primary question | Owns | Must not own |
| --- | --- | --- | --- |
| Today | What should I do now? | Time-ordered actionable tasks, quick logging, optional Light Day | Editing clinical source orders |
| My plan | What did my clinician recommend? | Readable plan summary, source documents, provenance, status, explicit edits | Daily completion or gamified compliance |
| Plan details | What exactly applies? | Medications, timing, restrictions, effective dates, confirmation of parsed fields | Autonomous clinical prescribing |
| History | What actually happened? | Logged events and corrections, date-aware audit trail | Retroactive assignment of tasks |
| Progress | What can I learn from records? | Transparent metrics, observation windows and missing-data explanations | Diagnostic conclusions |

## Navigation contract
1. The Today view links to plan details only with explicit user intent.
2. Returning from plan details restores the Today date, scroll and filter state.
3. An imported prescription is always a **draft** until the user confirms extracted fields; ambiguous dose/unit/timing is highlighted and never guessed.
4. Every active instruction retains its source, start date, and optional end date. Updating a plan does not rewrite past facts.
5. Empty, loading, error, offline, and demo states are distinct; demo data must never contaminate real data.
6. Accessible controls have explicit labels, keyboard focus and touch targets; critical actions cannot depend on color alone.

## Multi-plan readiness (no migration yet)
Future entities: `PlanId`, `PlanVersion`, `SourceDocumentId`, `PlanItemId`, `ProfileId`, `ConsentGrantId`.
- An action references a stable plan item and profile; a merged Today timeline may show items from multiple plans without merging their clinical provenance.
- Conflicting instructions are displayed for user/clinician resolution; the app does not decide which prescription wins.
- A caregiver sees only explicitly granted scopes; revocation and expiration must work offline eventually and be reconciled at sync.
- No server-side admin dashboard containing identifiable health histories. Operational telemetry is separated from encrypted patient data.

## Proposed implementation PRs
1. **UI-01:** reconcile existing `ui-ux/plan-screen-separation` changes; inventory routes and current components; capture baseline screenshots.
2. **UI-02:** extract plan display components without changing storage or behavior; add route and accessibility regression tests.
3. **UI-03:** distinguish plan read-only summary from plan editing; preserve back navigation and unsaved changes.
4. **UI-04:** introduce design tokens and reusable empty/error/loading states behind a feature flag.
5. **DOMAIN-01:** introduce stable plan identifiers and migration strategy in a separate RFC, with backup/restore compatibility tests.
6. **DOMAIN-02:** add multi-plan aggregation and conflict presentation after migration review.
7. **FAMILY-01:** consent and delegated-access threat model before any caregiver UI or server endpoints.

## Acceptance gates
- No regressions to medication schedules, PRN dose units, DST/timezones, sync encryption, offline use or Light Day.
- Unit, integration, Playwright, and visual checks for mobile viewport sizes.
- Green CI and explicit review before merge. Do not bypass failing jobs.
- Confirm the actual UI separation branch and rebase strategy before code touching `src/screens`.
