# UI-ARCH-01 — shared navigation shell

Base: UI-ARCH-00 at audited `main` (`9ab0256`). The UI-DAY-02 composition has not started. Its prerequisite is completed and accepted UI-ARCH-00.

## What changed

- Primary navigation is Сьогодні / Мій план / Результати / Більше. Existing hash routes and feature ownership are unchanged. Food is available in the existing food category and the drawer; food/meal/recipe deep links select Більше.
- A single shared header contains brand, drawer, live sync status and real reminder settings. The former Day-only brand/sync row is removed; greeting, profile entry, selected date/week and medical actions stay with their owners.
- A left drawer reuses `Sheet`/`sheetFocus`: Escape, backdrop, close button, background inertness, dynamic focus guards and opener focus restoration. It uses the same feature-filtered categories as More. It is not another account, profile or clinical-role permission mechanism.
- The existing theme RGB variables now use the approved mint colors and separate dark colors. Added hover/pressed/on-accent/secondary-surface/moved tokens. Inter is bundled locally with Cyrillic/Ukrainian coverage, and is precached for offline use.
- Card radius remains 18px, controls 14px. Main navigation has at least 64px height on mobile; all interactive targets retain 44px minimum. Drawer padding respects safe areas.
- Muted body copy uses `#5B756E` (4.81:1 against the light app background); the supplied `#627D77` was below AA for body copy. Moved state text uses `#7560B3` to exceed 4.5:1 on its supplied background. These are contrast corrections to the proposed palette.

## Preservation and scope

No medical action, dose time, prescription, plan schema, IndexedDB migration, sync protocol, entitlement or consent rule is changed. The existing forest/scene screen bodies intentionally remain until their own audited stages; the new shell is not presented as the finished Today design. #163's consent-snapshot correction and #164's meal rescheduling remain separate open dependencies.

Print behavior keeps the application header/navigation out of the document. The skip-to-content link focuses the actual main landmark without changing the hash route. Primary-tab selection groups existing secondary routes instead of introducing duplicate routes.

## Validation

- TypeScript and production/PWA build: passed.
- Client unit suite: 762/762 passed (74 files).
- Compatibility browser checks: 26 passed; the policy-only drawer case skipped by design. Includes clinical QR patient acceptance, report consent, nutrition, grouped directory, existing modal focus lifecycle, new drawer/focus/offline/data preservation, seven widths in both themes.
- Policy-enabled browser checks: **23 scenarios verified**, with one compatibility-only scenario skipped. The full run passed 21 cases, then two outdated navigation assertions were corrected and both passed a focused rerun. Includes disabled-module access, backup/history restoration, cross-tab module changes, all-route 320/390/768/1024px light/dark screenshots and fold/unfold transitions.
- The two corrected expectations now check the journal link rather than the whole food category, and require exactly one compact header instead of the superseded no-hamburger design. Both also passed a focused compatibility-mode recheck (2/2).
- Theme contrast: foreground/background pairs are measured by the shell browser test, minimum 4.5:1 for ordinary text in both themes.
- Visual QA: inspect `mockup-shell-*` test artifacts at 320/375/390/430/768/1024/1440px and the drawer. Fixtures contain synthetic data only.

The local runner uses an isolated Chromium 153 executable because the standard download was unavailable. No local browser workaround or environment configuration is committed. Remote publication, PR, CI and deployed preview verification remain pending; this document does not claim those steps have passed.
