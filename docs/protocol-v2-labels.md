# Protocol 2.0 UI naming

`mock2.png` is the primary reference for current UI labels; where it differs from `mock1.png`, use `mock2.png`. `mock1.png` remains a visual reference for the colored summary and single-plan surfaces. Mock2 also depicts future multi-plan, family and integration features; those labels do not imply those features exist in this release.

Canonical labels live in `src/i18n/uk.ts` and are shared by links, headings and accessible controls.

| Surface | Canonical label | Scope |
| --- | --- | --- |
| Main navigation | День · Їжа · План · Прогрес · Ще | Existing five tabs; a single plan remains «План». |
| Current-day heading | Сьогодні | The actual selected date remains beneath it. |
| Today's timeline | Найближче | Existing day timeline, placed before the metric summary. |
| Historical timeline | Ритм дня | Avoid calling a past day's history upcoming. |
| Today's metric summary | Сьогодні | Replaces «Уже сьогодні», matching the colored-ring mock. |
| Dated metric summary | Підсумок дня | Past/future selected date, rather than saying today. |
| Quick action group | Швидкі дії | Menu, wellbeing, workout and checklist. |
| Wellbeing quick action / screen | Самопочуття | Replaces the competing quick-action label «Мій стан». |
| Daily checklist | Мій день | Remains distinct from the timeline and summary. |
| Food entry | Записати їжу | Existing capture/search route. |
| Food photo action | З фото | Existing image capture; no new mode/tab is fabricated. |
| Recent meals | Останні | Distinct from «Мої звичні» favorites; follows mock2 where mock1 uses «Нещодавні». |
| New meal confirmation | Додати до дня | Creates the meal only after the user's tap. |
| Existing meal confirmation | Зберегти зміни | Edits the existing record. |
| Dish catalog | Мої страви | Existing catalog, import and export. |
| Plan heading | План лікаря | Matches both references; no multi-plan claim. |
| Plan restrictions | Дієта й обмеження | Keeps non-diet restrictions explicit. |
| Plan checkup | Наступний контроль | Existing tests and next visit. |
| Plan versions | Історія змін | One label for its link and heading. |
| Analytics / assistant | Прогрес · Помічник | Existing headings retained. |
| Supporting screens | Мотивація · Інсайти · Журнал самопочуття · Нагадування | Existing routes retained. |
| Settings group | Налаштування | Data actions remain inside this group. |
| Data transfer | Імпорт / експорт | Existing backup import/export, without claiming PDF/XLS support. |

Doctor-photo and safety labels retain their informative wording and confirmation meaning. In particular, recording a taken medicine is not relabelled as an instruction to take it. The medicine streak says «дози відмічено», because a recorded checkbox does not establish on-time ingestion.

## Latest screenshot correction

There is no water button, indicator or empty reserved row between quick actions and the next card. The dock stays mounted but hidden while quick actions are visible, then floats after scrolling. Its add/undo behavior remains. The timeline precedes the summary on all dates.

## Validation

Based on main `0f3da33`, preserving PR #20 plan previews and pilot persistence, module observation/reminder policy, allowed metrics, and the 2–3 metric selection rule. Client: 444 unit tests; server: 66 unit tests and typecheck; client typecheck and production build pass. Standard browser build: 95 passed, 3 conditionally skipped. The separate module-policy-enabled browser build passes all 6 selected observation/preferences/reminder-policy scenarios. The first-screen water action remains absent, adding/undo still works after scrolling, timeline precedes summary, dated labels remain accurate, and editing a meal updates its original record.
