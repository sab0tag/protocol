# UI-ARCH-00 — Protocol 2.0 redesign baseline

Audited base: `main` at `9ab0256525660059600e127f6440b45e6b0c607f`, 2026-11-04.
Scope: the owner's approved UI/UX redesign v2.1 and two approved mint reference images.
This is a preservation audit, not a claim of pilot readiness.

## Architecture and boundaries

- `src/app/navigation.ts` is the canonical route/feature catalog; `App.tsx` exhaustively maps its keys to screens. Keep existing hash URLs and deep links.
- `FeaturesProvider`, `FeatureGate` and `useMoreGroups` govern module visibility. Compatibility builds and policy-enabled builds differ intentionally; test both. Visibility does not prove server-side Free/Plus enforcement.
- Dexie, profile selection, observation events, encrypted sync and source-plan CAS/recovery remain their current owners. The shell must not migrate or write medical data.
- `Layout` currently owns a five-item bottom bar / desktop rail. It has no global header or drawer on this base. `DayHeader` separately owns brand, sync, greeting, date and week selection.
- `Sheet` / `sheetFocus.ts` already implement focus trapping, background inertness, Escape and focus restoration. Reuse that lifecycle for the drawer rather than adding a second modal system.
- `SceneHeader` and `DayHeader` currently use forest imagery. The approved calm mint direction supersedes that visual treatment; migrate shared chrome before redesigning individual screens.
- `src/styles/index.css` owns RGB-triplet theme variables, explicit/system light/dark themes, control/card radii and reduced-motion rules. `tailwind.config.js` maps existing tokens. Extend this system; do not introduce parallel HEX variables.
- Fonts are currently bundled Golos Text 400/500/600. v2.1 calls for bundled Inter with Ukrainian coverage. Keep offline font delivery and record the font change explicitly.

## Route and module preservation matrix

All existing route families remain reachable. Dynamic IDs/query strings are retained; moving a navigation entry must not move its screen or storage.

| Route family | Existing owner / behavior | Redesign entry | Regression evidence to retain |
| --- | --- | --- | --- |
| `/`, `/my-day`, `/do/:action` | Day checklist, current action, water/med/food/voice, date state | Сьогодні; contextual task actions | `day`, `quick`, `protocolV2Today`, `skipLifecycle`, `returnAfterBreak`, `lightDayUi` |
| `/food`, `/meal/new`, `/meal/:id` | Nutrition hub, food entry, confirmation, ingredient checks | Більше → Їжа; drawer → Моє харчування; existing day actions | `nutritionOverview`, `foodEntryOverview`, `meal`, `protocolV2Food`, `uiNaming`, `repeatMealTarget` |
| `/dishes`, `/foods`, `/menu`, `/shopping` | Recipes, product catalog, menu and shopping | Existing food category and drawer group | `dish`, `dishList`, `dishesCatalog`, `menu`, `diets` |
| `/plan`, `/plan/prescriptions`, `/plan/constraints`, `/plan/goals`, `/plan/checkup`, `/plan/history` | Plan editor, schedules, constraints, goals and versions | Мій план and existing detail links | `plan`, `planBackup`, `prescriptionTimes`, `planStorage` |
| `/plan/scan`, `/plan/import` | Photo/file recognition, reviewed import, QR redemption | Мій план → add/import; existing deep links | `protocolV2Import`, `protocolV2ImportTimes`, `reviewDraft`, `reviewDraftFailure`, `planImportBusy` |
| `/clinic`, `/clinic/invite` | Clinic issuer, invitations, role boundaries | Existing onboarding/clinic links; drawer clinic entry | `clinicIssuer`, `invitations`, `clinicPortalGuide`, `clinicPatientAcceptance` |
| `/workout`, `/exercises` | Workout logging and exercise catalog | Health category and drawer | `workout`, `workoutOverview` |
| `/wellbeing`, `/wellbeing/journal`, `/weight` | Wellbeing/measurement entry and history | Health category and drawer, visibility rules unchanged | `observation`, `weightQuality`, `moduleSettings` |
| `/progress`, `/progress/labs`, `/progress/insights`, `/progress/motivation`, `/week`, `/report` | Progress, observations, report consent/export | Результати and health category | `progress-chart`, `labs`, `reportMeds`, `reportConsent` |
| `/more`, `/more/:category` | Existing grouped directory and appearance settings | Більше; same route/category IDs | `more`, `moduleSettings`, `profilePreferences` |
| `/profiles`, `/modules`, `/reminders`, `/sync`, `/quick`, `/data` | Profiles, feature switches, reminders, encrypted sync, shortcuts, backup | Settings category / drawer | `profiles`, `moduleOnboarding`, `modulePreferences`, `moduleSettings`, `reminderPolicy`, `sync`, `sourcePlanRecovery`, `sourcePlanTransport` |
| `/assistant`, `/concierge-log` | AI assistance and local history | Existing food/app groups | `assistant`, `concierge`, `voice` |
| `/welcome`, `/about`, `/pilot`, `/frictions`, `*` | Onboarding, demo isolation, information, feedback, fallback | Existing routes, application group | `onboardingPreview`, `pilot`, `feedback`, `recovery`, `upgradeRegression` |

Evidence column identifies existing spec-file names, not a claim that every case was executed in this audit. No route, module or AI capability should be marked ready solely because a screen exists.

## Token migration

| Existing variable | Current light | Approved light target | Current dark | Approved dark target |
| --- | --- | --- | --- | --- |
| `--bg` | `#F1F4F0` | `#F7FCFA` | `#080D0A` | `#101C19` |
| `--surface` | `#FDFFFC` | `#FFFFFF` | `#121A16` | `#1B2B26` |
| `--ink` | `#1F2E25` | `#153B35` | `#EBF2E9` | `#F0F8F4` |
| `--muted` | `#5B6C61` | contrast-adjusted `#627D77` | `#A5B7AB` | `#A6BDB3` |
| `--line` | `#DBE5DC` | `#DFEBE7` | `#27352D` | `#344B42` |
| `--accent` | `#0F7662` | `#007D59` | `#6EE7C4` | `#56D7A8` |

Add secondary surface, brand hover/pressed, on-accent and moved-status tokens to the same RGB system. Light `#627D77` on `#F7FCFA` is approximately 4.3:1 and needs a darker body-copy value for AA. Keep the supplied shade for non-text decoration only if necessary. Check actual component foreground/background pairs, including dark buttons, muted copy and badges; never infer contrast from token names.

Radii already match the proposed 18px card / 14px control base. Preserve the 44px minimum hit area, safe-area padding, reduced-motion preference and existing theme storage key. New header is 56–64px; bottom bar 64–72px plus safe area. Main reading area must fit 320/375/390/430/768/1024/1440px.

## Existing dependencies and readiness limits

- #163 is still open, head `3948bf4089d9d54c633aea61a00e668b433c94a2`. It integrates exact-report-snapshot consent validation. Its body mentions an older head; inspect current CI before review/merge. Do not quietly fold it into a visual PR.
- #164 is open on the integration branch, head `d9ee7b9590b3dc0befc4fedb0ad7fd3a02658515`. Meal rescheduling is not in this audited `main`; preserve that feature when the branches are later integrated.
- Clinic acceptance includes a reviewed prescription **without a schedule** until the patient explicitly configures it. The redesign must not fabricate dose times.
- QR receipt status is not report access. `reportConsent.spec.ts` checks patient-side sharing; it does not prove doctor-side scoped report delivery/revocation.
- `docs/pilot-153-runbook.md` is explicitly not executed. Remote Hetzner API version, OIDC/SMTP, scoped doctor reporting and paid server entitlement enforcement still need independent evidence.
- Keep genuine readings, records, consent, plan outcomes and quantitative goals separate. Never turn a navigation change into an automatic medical action.

## Implementation sequence / review boundary

1. **UI-ARCH-00** (this PR): preservation map, baseline verification, dependencies and migration decisions.
2. **UI-ARCH-01**: four primary tabs (Сьогодні / Мій план / Результати / Більше), one compact brand/menu header, accessible drawer, existing destinations and feature filtering, bundled Inter and theme integration. Retain screen-specific behavior until its own stage.
3. **UI-DAY-01**: reuse checklist/rhythm/visibility/adherence selectors for the day presentation model; tests for no inferred clinical priority or completion.
4. **UI-DAY-02** (**blocked until UI-ARCH-00 is complete**): approved mint Today composition, one priority task, upcoming list, collapsible goals and confirmed history; remove legacy forest hero here.
5. **UI-PLAN-01**: full plan, sources, restrictions and existing QR/photo entry paths.
6. **UI-ACTION-01**: reuse existing action handlers in a shared detail layout; keep stale-state checks, skip confirmation, undo and history.
7. **UI-RESULTS-01**: results and goals independently, real report consent preserved; integrate #163 only through its reviewed dependency.
8. **UI-POLISH-01**: visual comparison, contrast/focus, phone/tablet/foldable/desktop, offline and complete synthetic acceptance.

The owner explicitly requires UI-ARCH-00 completion before UI-DAY-02 starts. Completion means the existing-route/module map, dependency review, preservation matrix and baseline behavior evidence are finished; an attractive mockup or an unfinished audit does not satisfy this gate. Record the audit acceptance before starting the Today composition.

Each stage has a separate branch/PR and preview. No merge into `main` or production deployment is authorized by this document. Never upload the owner's private screenshots/documents, real medical data or credentials as repository fixtures.

## Verification on the audited base

- `npm test`: **762/762 passing**, 74 test files.
- `npm run build`: **passed**, including TypeScript and PWA assets. Existing bundle-size warning remains.
- Focused acceptance on an isolated checkout of the audited base: **12/12 passed** (`clinicPatientAcceptance`, `reportConsent`, `sourcePlanTransport`, `skipLifecycle`). This covers QR receipt/replay/revoke/isolation/offline/reviewed activation, explicit report sharing, confirmed skips/undo/reasons and two-device durable transport.
- Local browser prerequisite resolved using an isolated Chromium 153 runtime after the standard download returned an empty/corrupt archive. The override is outside the repository; the normal Playwright/CI configuration is unchanged.
- Visual reference review: both approved mint compositions inspected locally; neither has been committed to the repository.

Audit implementation and selected baseline verification are complete. Remote PR/CI/preview review is still pending publication; UI-DAY-02 remains gated until the audit is accepted. CI and preview results must be recorded per implementation stage.
