# Server deploy A — 18.11.2026

Owner's decision 18.11: the API goes out in two passes. **A** — current `main` without the water schema change (`server/` at
`74c21df`); **B** — the water schema (`waterMaxMl`, D169) on 19.11, if A runs a day without new errors, with a fresh backup and
the rollback ready. `CLINIC_IDENTITY_V2` stays off; no clinic is created on production.

## Before
- The box ran `server/` from 24.10 (83 files behind: AI gateway and budgets, clinic, migrations).
- Env: nothing new is required by the new code; the new variables are optional (OIDC, SMTP, OpenRouter, AI budgets, VAPID).
  `CLINIC_IDENTITY_V2` unset → staff sign-in off.
- Backup: `backups/predeploy-20261118b.db` (consistent copy, `VACUUM INTO`), taken right before the deploy.
- Migrations on a copy of the production database, twice: `legacy → 5`, then «up to date». Row counts in every existing table
  equal before and after (vaults 18, records 670, reminders 104, push_subs 1, …); the new clinic tables empty.
- The new image started offline (`--network none`) on a copy: `/health` ok.
- Rollback, one command: `sh ~/rollback-20261118.sh` (code and image as before; `… db` also puts the database back to the backup).
- The Anthropic key was replaced first (the old one belonged to another organization whose balance was empty; the whole AI was
  down since ~11:00): smoke on the old code passed with the new key.

## Deploy
`server/` at `74c21df` into `/opt/protocol-api`, image `protocol-api-api:next` → `latest`, `docker compose up -d --no-build api`.
Started 16:30 UTC, healthy, migrations at start, 0 restarts.

## Smoke after (from the box, `~/smoke/smoke.ts`, a throwaway vault, synthetic images)
| Check | Result |
| --- | --- |
| `/health` | ok, every feature on, AI not failing |
| Schema | 5; vaults 21, records 679 (the 18 / 670 before + three throwaway smoke vaults); clinics 0 |
| Sync on two devices | A → B and B → A |
| Photo | «гречка варена, 180 г» on a synthetic plate |
| Prescription reader | readable, «Бісопролол» (the fluid limit is not read yet — that is pass B) |
| Assistant | answered («перекус без молочного») |
| Budget | counted: $0.07 for the run |
| Errors in the API log since start | 0 |

## Pass B, 19.11 — conditions
- A day without new errors in the API log (check `docker logs --since <A start>`).
- A fresh backup right before; the rollback script pointed at it.
- Then: `server/` from `main`, the same smoke, plus one live reading of a paper with «обмеження рідини до 1,5 л» → `waterMaxMl 1500`.
