# UI-RESULTS-01 — results and goals

Stage 7 of the redesign sequence in `ui-arch-00-redesign-audit.md`. It shows results and goals separately and keeps the real report consent. #163 (exact report-snapshot consent) is already in `main`, so this stage builds on it and does not change it.

## What changes

- **Heading.** «Результати» (`/progress`) opens with a plain mint heading, as «Сьогодні» and «Мій план» do. The forest photo header is gone. The heading text now matches the tab name «Результати» instead of «Прогрес». «Звіт для лікаря» sits next to it as a secondary action. One line under it says the report leaves the phone only after the person agrees.
- **Two separate parts.**
  - **«Вимірювання і записи»** shows what the person measured and recorded: weight, wellbeing days and recorded workouts. Each card has a real number, its period and a link to the records (D146). The weight chart follows the cards. None of these values is compared with a goal here.
  - **«Цілі плану»** shows how many days the records kept the plan's goals and limits: carbohydrates within the limit, protein, water and the daily plan share. The light-day history explains which days are not counted. A link opens «Тиждень по днях». This part states that it is not a health assessment.
- **No double counting.** The «План» card repeated the «План дня» percentage, so it is removed, and the plan share is shown once, in the goals part. The workout count is a record, so it appears only in the results part. Nothing is combined into one score.
- **Independent visibility.** Results follow their own modules (weight, wellbeing, workouts). The goals part stays available when those modules are off, and a module that is off is still not counted as zero.

## What does not change

- The doctor's report and its consent flow are unchanged (D158). «Поділитися» opens a confirmation that names what is in the text, and «Передати звіт» stays disabled until the person agrees. Print is unchanged.
- No calculation changes: week summaries, light-day handling, weight quality and pace limits, labs, patterns and module/observation policy all stay as they were.
- Storage, sync, entitlements and routes are unchanged, and labs, motivation and insights stay reachable from the same links.

## Verification

- `resultsGoals.spec.ts`:
  - results and goals are two parts with no goal rings among the recorded values;
  - the plan share appears once and no «План» card remains;
  - the workout count is not repeated in the goals part;
  - the order is results, then goals;
  - there is no horizontal overflow at 320, 768 and 1440 px;
  - the report opened from «Результати» is not shared before consent.
- Updated: `progress-chart.spec.ts` (D146 cards in the results part, the week link in the goals part), `plan.spec.ts` (region name) and `sceneContrast.spec.ts` (the plain heading has no photo to measure).
- Regression, run in both acceptance and compatibility builds: `progress-chart`, `plan`, `lightDay`, `weightQuality`, `reportConsent`, `sceneContrast`, `foldableLayout`, `narrowLayout` and `moduleSettings` pass.
