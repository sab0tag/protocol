# Protocol 2.0 — isolated synthetic pilot runbook (issue #153)

Status: **NOT YET EXECUTED**. This is an operator checklist, not evidence of pilot readiness.

## Deployment boundary

- Web frontend: https://protocol.beyondthesignal.to (Vercel, `main`). Confirm its Git SHA and READY deployment before testing.
- API: https://api.beyondthesignal.to (separate Hetzner Docker deployment). **Never infer API version from Vercel**.
- Before any API rollout: record current image/digest, database schema/migration version, backup timestamp, restore test and rollback procedure. Keep tokens and health records out of tickets, logs and screenshots.
- Do not create a clinic or change identity/SMTP settings in production. Use an isolated environment and synthetic identities.
- No real patient onboarding until security, privacy and clinical sign-off.

## Pilot fixtures

Use a synthetic clinic `Пілотна клініка 153`, a synthetic admin, a synthetic doctor and two synthetic patient browser profiles. Create a fictional plan containing one medication, one meal constraint, one water goal, one exercise and one laboratory reminder. Use invented names and doses; label everything `DEMO / SYNTHETIC`. Use a separate empty profile to test QR redemption; do not reuse a real user's IndexedDB.

## Manual scenario and evidence

| ID | Actor | Action | Expected result |
| --- | --- | --- | --- |
| P01 | Operator | Confirm isolated API URL, SHA, migration, backup and rollback | Environment and rollback evidence recorded |
| P02 | Admin | Sign in, select clinic, invite doctor with intended role | Doctor sees only assigned clinic and permissions |
| P03 | Doctor | Open `/#/clinic`, create fictional plan, issue QR | One-time delivery is created, QR visible, no sensitive data in logs |
| P04 | Patient A | Open QR in separate browser, preview plan | Original details and attribution are readable; no automatic activation |
| P05 | Patient A | Confirm plan explicitly | Plan persists locally after refresh; doctor sees receipt status only |
| P06 | Patient B | Reuse same QR | Denied; no plan created |
| P07 | Doctor | Revoke a second, unused QR; test expired QR | Redemption denied, existing local plan preserved |
| P08 | Patient A | Mark medication taken/late/skipped, meal, water, workout and lab reminder | Each event survives reload; missed events remain distinguishable |
| P09 | Patient A | Generate report without consent | No unauthorized clinic access to diary/report |
| P10 | Patient A | Explicitly share report, then revoke/expire access | Doctor sees only consented report within its valid scope; access stops afterward |
| P11 | Operator | Compare synthetic Free and Plus accounts | Enforced entitlements match product rules on server and client |
| P12 | Patient A | Lose network mid-import and retry | Safe failure and recovery; no accidental duplicate or overwrite |
| P13 | QA | Repeat on 320px, 390px, desktop, foldable, light/dark and PWA restart | No clipped actions, lost state, inaccessible dialog or route regressions |

For each step record: date, environment, frontend SHA, API SHA, browser/device, expected vs actual, sanitized evidence link, and issue ID for failures. Mark **BLOCKED**, not PASS, when prerequisites or capabilities are missing.

## Automated regression references

- `tests/e2e/clinicPatientAcceptance.spec.ts`: doctor QR → patient redemption, replay, revoke, tenant isolation and offline.
- `tests/e2e/clinicPortalGuide.spec.ts`: first-entry guide and temporary token login.
- `tests/e2e/reportConsent.spec.ts`: patient-side report consent UI.
- `tests/e2e/pilot.spec.ts`: existing pilot behavior.

Automated tests do not prove the remote API version, deployed configuration, real email/OIDC, report delivery to doctor, or paid entitlement enforcement. These require independent evidence.

## Go / no-go

**GO** only if all P0 checks in #153 have verified evidence, no unresolved safety/security blocker, and explicit owner approval. Otherwise **NO-GO**. This document does not authorize production deployment.
