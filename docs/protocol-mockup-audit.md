# Mockup alignment audit

`mock2.png` is the primary visual reference when the two supplied mockups differ. The references describe presentation, not authorization to add unfinished clinical, family-sharing, or integration behavior. Existing medical safeguards, user-entered targets, consent gates, and accessible control semantics remain authoritative.

## Screen inventory

| Screen / route | Mockup reference | Audit state |
|---|---|---|
| Today — `/` | Today / greeting / timeline | Shared shell updated; detailed review pending |
| Add food — `/meal/new` | Record food | Shared header updated; detailed review pending |
| Edit meal — `/meal/:id` | Food detail / editing | Shared header updated; detailed review pending |
| My day — `/my-day` | Daily checklist | Example-data warning order checked; detailed visual review pending |
| Wellbeing — `/wellbeing` | Daily health tracking | Header and rating controls visually checked; remaining widths/themes pending |
| Wellbeing journal — `/wellbeing/journal` | History / trend | Pending |
| Workout — `/workout` | Activity tracking | Pending |
| Exercises — `/exercises` | Exercise library | Shared header updated; detailed review pending |
| Quick action — `/do/:action` | Action state | Behavior tested separately; action links are not visual screens |
| Quick links — `/quick` | Additional actions | Shared header updated; detailed review pending |
| Frictions — `/frictions` | Feedback | Shared header updated; detailed review pending |
| Pilot — `/pilot` | Additional capability | Pending |
| Week — `/week` | Weekly progress | Shared header updated; detailed review pending |
| Doctor plan — `/plan` | Doctor's plan | Visually reviewed at 390 px in light and dark; intentionally retains the section photo and demo-data warning; multi-plan controls remain unavailable |
| Prescriptions — `/plan/prescriptions` | Doctor's plan | Pending |
| Restrictions — `/plan/constraints` | Doctor's plan | Pending |
| Goals and modes — `/plan/goals` | Doctor's plan | Pending |
| Checkups — `/plan/checkup` | Doctor's plan | Pending |
| Scan plan — `/plan/scan` | Photograph prescription | Pending |
| Plan history — `/plan/history` | Plan versions | Pending |
| Onboarding — `/welcome` | First-run setup | Pending |
| Progress — `/progress` | Progress / trends | Visually reviewed at 390 px in light and dark; weekly rings compacted toward the mockup; workout remains an honest count; data-detail links follow the weight chart; date-range selector and chart framing still differ |
| Insights — `/progress/insights` | Key indicators | Shared header updated; detailed review pending |
| Motivation — `/progress/motivation` | Motivation | Shared header updated; detailed review pending |
| Lab results — `/progress/labs` | Results and trends | Shared header updated; detailed review pending |
| Report — `/report` | Doctor's report | Pending |
| Dishes — `/dishes` | My dishes | Catalog visually reviewed at 320, 390, 768, and 1024 px in both themes; intentionally retained section photography; details/actions remain available |
| Foods — `/foods` | Food catalog | Shared header updated; detailed review pending |
| Data — `/data` | Import / export | Shared header updated; detailed review pending |
| More — `/more` | Additional capabilities | Shared header updated; detailed review pending |
| More category — `/more/:category` | Settings / integrations | Shared header updated; detailed review pending |
| About — `/about` | About the app | Shared header updated; detailed review pending |
| Concierge log — `/concierge-log` | Assistant history | Shared header updated; detailed review pending |
| Assistant — `/assistant` | Contextual assistant | Header updated; empty-state composer aligned above mobile navigation |
| Sync — `/sync` | Device synchronization | Shared header updated; detailed review pending |
| Menu — `/menu` | Meal suggestions | Shared header updated; detailed review pending |
| Reminders — `/reminders` | Settings | Shared header updated; detailed review pending |
| Shopping — `/shopping` | Shopping list | Shared header updated; detailed review pending |
| Profiles — `/profiles` | Family and profiles | Shared header updated; detailed review pending |

Dynamic meal and action routes are covered by their respective route templates. The inventory intentionally records existing routes only; unfinished mockup concepts do not imply that their underlying capabilities exist.

## Shared component inventory

The shared component surface comprises: `AiSpend`, `AiWorkoutPanel`, `AllergenPicker`, `Amount`, `Backup`, `BreakdownEditor`, `ConciergeNotFound`, `ConfirmMeal`, `CrisisCard`, `DangerCard`, `DayHeader`, `DayRhythm`, `DaySummary`, `DietPicker`, `DishBreakdown`, `DishList`, `EntryPreview`, `ExampleNotice`, `ExerciseCard`, `ExerciseFigure`, `ExerciseLibrary`, `Favorites`, `ItemPicker`, `LabelScan`, `LabsScan`, `Layout`, `MarkTime`, `MedFoodPanel`, `MedboxScan`, `NeedsSync`, `NowCard`, `PhotoPrep`, `PilotConsent`, `PlanOverview`, `PlanScan`, `PlanVersions`, `PrnCard`, `ProfilePhotoSettings`, `ProgressRing`, `ProgressTrack`, `QuickDock`, `RecentMeals`, `Recovery`, `SceneHeader`, `Sheet`, `Soon`, `SymptomSheet`, `Toast`, `TopupCard`, and `VoiceSheet`.

Shared visual systems audited alongside those components: color and type tokens, system and user-selected light/dark mode, card/control radii, form fields, rings and bars, chart framing, navigation, focus treatment, reduced motion, and narrow-screen overflow.

## Current pass and open review

- Integrated each section's locally cached image into its page header, with a left-side dark gradient and the photo visible on the right; the woodland hero remains on Today.
- Removed the repeated active-profile strip from the global shell; the active person's name remains in the Today greeting and in profile management.
- Reduced the shared card radius and ring diameter, refined dark-theme colors toward the mockup, and simplified the tab icon treatment.
- Converted the plan overview and wellbeing date header to regular theme-aware surfaces.
- Added locally cached header photography for food, movement, care, wellbeing, settings, and assistant routes; Today keeps its existing forest hero.
- Updated the Today greeting to use the active profile name and exact day-part text without punctuation; recent meals now filter through breakfast/lunch/dinner/snack tabs and can be favorited with a red heart.
- Moved the existing demo-data warning ahead of the example schedule cards on Today and added it to My day before its sample checklist, so example medication status is always caveated before action.
- Extended the same warning to Add food, Workout, Week, Insights, Motivation, Wellbeing, its journal, Assistant, Menu, Dishes, My foods, Labs, Plan history, Plan scan, and Data/backup, where sample records can be edited, exported, or summarized. Printed reports retain the example label but omit its action button. Browser coverage verifies these safeguards; this is not a completed visual review of those screens.
- Expanded browser geometry coverage to all routed screens and the requested 320, 390, 768, and 1024 px widths in both themes. This is a regression gate, not a substitute for visual comparison.

### Section artwork sources

The header photos are downloaded and cached locally (WebP), so route views do not make third-party image requests. Images are from Unsplash under its [official license](https://unsplash.com/license), which permits free commercial and non-commercial use without required attribution:

| Section | Image |
|---|---|
| Food | [Fresh vegetables and fruit meal](https://unsplash.com/photos/fresh-vegetables-and-fruit-meal-k3DmHnnAH3M) |
| Movement | [Woman lifting weights in a gym](https://unsplash.com/photos/woman-lifting-weights-in-a-gym-IYLLF511aOY) |
| Care plan and report | [Doctor wearing a stethoscope at a desk](https://unsplash.com/photos/doctor-wearing-a-stethoscope-sits-at-a-desk-JJEOuvnY1Tw) |
| Wellbeing and progress | [Sunlight filtering through green leaves](https://unsplash.com/photos/sunlight-filtering-through-green-leaves-with-bokeh-effect-rYYFOBEkGM0) |
| Settings and profile | [Potted plant by a sunlit wall](https://unsplash.com/photos/potted-plant-by-sunlit-wall-jV8ViVM_piA) |
| Assistant | [Abstract network of dots](https://unsplash.com/photos/an-abstract-image-of-a-network-of-dots-s5C_4tMY8fA) |

Food list thumbnails are cached locally from Unsplash under its [official license](https://unsplash.com/license), which permits free use without required attribution:

| Thumbnail | Image source |
|---|---|
| Oatmeal and grain dishes | [Unsplash photo](https://images.unsplash.com/photo-1702648982253-8b851013e81f) |
| Chicken dishes | [Unsplash photo](https://images.unsplash.com/photo-1532550907401-a500c9a57435) |
| Vegetable dishes | [Unsplash photo](https://images.unsplash.com/photo-1512621776951-a57141f2eefd) |
| Lavash and sandwiches | [Unsplash photo](https://images.unsplash.com/photo-1671572578870-1fcac451899b) |
| Eggs and omelettes | [Unsplash photo](https://images.unsplash.com/photo-1518569656558-1f25e69d93d7) |
| Fish | [Unsplash photo](https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2) |
| Dairy | [Unsplash photo](https://images.unsplash.com/photo-1550583724-b2692b85b150) |
| Fruit | [Unsplash photo](https://images.unsplash.com/photo-1610832958506-aa56368176cf) |
| Soup | [Unsplash photo](https://images.unsplash.com/photo-1476718406336-bb5a9690ee2a) |

### Manual visual checks

| Screen | Viewport / theme | Observation |
|---|---|---|
| Today | 320/390/768/1024 px / dark; 390 px / light | The woodland header, greeting, week strip, quick actions, and bottom navigation render without clipping; 768/1024 use the icon rail and centered content column. The example-data warning now precedes the sample missed-item card. The mockup's plan chip and compact metric placement still differ; detailed below-the-fold comparison remains pending. |
| My day | 320 px / dark | The sample-data warning appears before checklist progress and action rows; the checklist remains within the viewport width. Full width/theme comparison remains pending. |
| Add food | 320 px / dark; 390 px / light | All four input modes fit with no horizontal overflow at 320 px. Recent meal cards use local photos for all nine supported food categories. |
| Wellbeing | 320 px / dark and light; 1024 px / light | The photo header, demo-data warning, daily rating groups, symptom chips, and journal link remain legible with no horizontal overflow at the checked widths. |
| Wellbeing journal | 320 px / light | The demo-data warning precedes the sample entries; the long list scrolls beneath the fixed navigation without horizontal overflow. Other widths/themes are covered by the browser geometry matrix. |
| Doctor plan | 390 px / light and dark | The intended care-section photo and safety notice about demo records remain intact. Existing single-plan sections render without clipping; multi-plan status rings and controls are not shown because the new storage model is deliberately not UI-writable until backup/sync compatibility is implemented. |
| Progress | 390 px / light and dark | Weekly carbohydrate, protein, water, and checklist rings now use compact cards closer to the mockup; workouts remain a plain count without an invented target. The weight trend is a responsive line chart, followed by analysis and insight links; the date-range selector and chart framing still differ. |
| Profiles | 390 px / dark | Local profile creation and same-profile device connection are visible. The mockup's shared-access controls and per-person portraits are not implemented. |
| Settings | 390 px / dark | The local profile-photo upload and settings links are visible. A theme toggle now supports light/dark overrides and return to the device setting. The mockup's other consolidated settings controls remain distributed across existing routes. |
| Add food | 320 px / light | The photo, voice, text, and label-scan actions remain visible below the photographic header; no horizontal overflow. |
| Assistant | 390 px / dark | The image is part of the rounded header; prompt chips follow the daily context and the empty-state composer sits above bottom navigation. |
| Settings | 768 px / dark | The profile-photo card and settings links render beneath the integrated header; no clipping or horizontal overflow. |
| Workout | 1024 px / light | The image is integrated into the header; the previous/next controls remain legible against their surface buttons. |
| Add food | 390 px / light and dark | Recent meal categories and favorite controls are present. All nine supported food categories use cached local photographs. |
| Dishes | 320, 390, 768, and 1024 px / light and dark | Search, horizontally scrollable filters, photo cards, favorites, and navigation remain legible with no horizontal overflow. The catalog matches the mockup's card-and-filter structure; the intentionally retained section-photo hero is larger than the mockup's compact title row. Long details and editing actions stay available from each card; the existing editor follows the catalog. |

The expanded E2E matrix initially found horizontal overflow on Motivation at 320 px. Habit labels and right-hand status text now have explicit shrink/wrap constraints; all checks passed on PR #28.

### Latest screenshot review

- Reviewed the contact sheets for all 42 previously captured routes at 320, 390, 768, and 1024 px in both light and dark themes. This is a layout-level visual triage, not a pixel-level comparison of every screen against a mockup.
- `/do/water` is an action deep link, not a screen: opening it records water and shows an undo notification. It was removed from the visual screenshot loop so it cannot change the seeded day or leave a transient notification over later screenshots. Its behavior remains covered by `tests/e2e/quick.spec.ts`; the visual matrix now covers 41 screens (328 screenshots).
- The supplied mockups depict only a subset of the existing routes. On the represented flows, current content and behavior differ where noted above: the active journal UI still uses the legacy single-plan model, and the prepared multi-plan storage is not yet writable; profiles remain local rather than providing shared family access. These are product-capability differences, not permission to invent clinical or sharing behavior.
- On the empty assistant screen, the composer now sits near the bottom navigation instead of directly below suggestion chips, matching the mockup's chat layout; an E2E geometry assertion guards the spacing.
- The Progress screen now surfaces the existing seven-day carbohydrate, protein, water, workout, and checklist summary before the weight section. It reuses the established data-coverage rules; date-range selection and the mockup's chart framing remain different.
- The Progress screen's carbohydrate, protein, water, and checklist indicators use the existing accessible ring component in compact mock-scale cards. Workouts remain a plain count because there is no target to justify a completion percentage; the shared Motivation card retains its prior tile layout.
- Visually compared the Dishes catalog with the mockup at all four requested widths in both themes. Search and meal filters precede compact image cards with favorite and overflow actions; at 320 px labels wrap without clipping, and wider layouts retain the centered content column. The section-photo hero is intentionally preserved per product direction; detailed ingredient and editing controls remain expandable rather than crowding the catalog.
- Keep the intentionally added section and food photography unchanged. The screenshot matrix checks responsive layout, theme selection, navigation, header-art presence, and horizontal overflow; it does not establish pixel-level equivalence.

The browser matrix captures the 41 visual screens at 320, 390, 768, and 1024 px in both themes. Food cards use local category illustrations as image-like thumbnails; the section header photos do not replace the per-food photographs shown in mockups.

Still to do: complete detailed, screen-by-screen comparison for the screens represented in the mockups; resolve confirmed presentation differences without changing the intended artwork or adding product capabilities; and record deliberate differences caused by functionality/accessibility. PRs #38 and #40 are merged after green CI. The compact-ring update passed local typecheck, 528 unit tests, production build, and focused Playwright coverage at 320/390/768/1024 px in both themes.
