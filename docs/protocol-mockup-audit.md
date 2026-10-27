# Mockup alignment audit

`mock2.png` is the primary visual reference when the two supplied mockups differ. The references describe presentation, not authorization to add unfinished clinical, family-sharing, or integration behavior. Existing medical safeguards, user-entered targets, consent gates, and accessible control semantics remain authoritative.

## Screen inventory

| Screen / route | Mockup reference | Audit state |
|---|---|---|
| Today — `/` | Today / greeting / timeline | Shared shell updated; detailed review pending |
| Add food — `/meal/new` | Record food | Shared header updated; detailed review pending |
| Edit meal — `/meal/:id` | Food detail / editing | Shared header updated; detailed review pending |
| My day — `/my-day` | Daily checklist | Pending |
| Wellbeing — `/wellbeing` | Daily health tracking | Header updated; detailed review pending |
| Wellbeing journal — `/wellbeing/journal` | History / trend | Pending |
| Workout — `/workout` | Activity tracking | Pending |
| Exercises — `/exercises` | Exercise library | Shared header updated; detailed review pending |
| Quick action — `/do/:action` | Action state | Pending |
| Quick links — `/quick` | Additional actions | Shared header updated; detailed review pending |
| Frictions — `/frictions` | Feedback | Shared header updated; detailed review pending |
| Pilot — `/pilot` | Additional capability | Pending |
| Week — `/week` | Weekly progress | Shared header updated; detailed review pending |
| Doctor plan — `/plan` | Doctor's plan | Overview card updated; detailed review pending |
| Prescriptions — `/plan/prescriptions` | Doctor's plan | Pending |
| Restrictions — `/plan/constraints` | Doctor's plan | Pending |
| Goals and modes — `/plan/goals` | Doctor's plan | Pending |
| Checkups — `/plan/checkup` | Doctor's plan | Pending |
| Scan plan — `/plan/scan` | Photograph prescription | Pending |
| Plan history — `/plan/history` | Plan versions | Pending |
| Onboarding — `/welcome` | First-run setup | Pending |
| Progress — `/progress` | Progress / trends | Shared header updated; detailed review pending |
| Insights — `/progress/insights` | Key indicators | Shared header updated; detailed review pending |
| Motivation — `/progress/motivation` | Motivation | Shared header updated; detailed review pending |
| Lab results — `/progress/labs` | Results and trends | Shared header updated; detailed review pending |
| Report — `/report` | Doctor's report | Pending |
| Dishes — `/dishes` | My dishes | Shared header updated; detailed review pending |
| Foods — `/foods` | Food catalog | Shared header updated; detailed review pending |
| Data — `/data` | Import / export | Shared header updated; detailed review pending |
| More — `/more` | Additional capabilities | Shared header updated; detailed review pending |
| More category — `/more/:category` | Settings / integrations | Shared header updated; detailed review pending |
| About — `/about` | About the app | Shared header updated; detailed review pending |
| Concierge log — `/concierge-log` | Assistant history | Shared header updated; detailed review pending |
| Assistant — `/assistant` | Contextual assistant | Shared header updated; detailed review pending |
| Sync — `/sync` | Device synchronization | Shared header updated; detailed review pending |
| Menu — `/menu` | Meal suggestions | Shared header updated; detailed review pending |
| Reminders — `/reminders` | Settings | Shared header updated; detailed review pending |
| Shopping — `/shopping` | Shopping list | Shared header updated; detailed review pending |
| Profiles — `/profiles` | Family and profiles | Shared header updated; detailed review pending |

Dynamic meal and action routes are covered by their respective route templates. The inventory intentionally records existing routes only; unfinished mockup concepts do not imply that their underlying capabilities exist.

## Shared component inventory

The shared component surface comprises: `AiSpend`, `AiWorkoutPanel`, `AllergenPicker`, `Amount`, `Backup`, `BreakdownEditor`, `ConciergeNotFound`, `ConfirmMeal`, `CrisisCard`, `DangerCard`, `DayHeader`, `DayRhythm`, `DaySummary`, `DietPicker`, `DishBreakdown`, `DishList`, `EntryPreview`, `ExampleNotice`, `ExerciseCard`, `ExerciseFigure`, `ExerciseLibrary`, `Favorites`, `ItemPicker`, `LabelScan`, `LabsScan`, `Layout`, `MarkTime`, `MedFoodPanel`, `MedboxScan`, `NeedsSync`, `NowCard`, `PhotoPrep`, `PilotConsent`, `PlanOverview`, `PlanScan`, `PlanVersions`, `PrnCard`, `ProfilePhotoSettings`, `ProgressRing`, `ProgressTrack`, `QuickDock`, `RecentMeals`, `Recovery`, `SceneHeader`, `Sheet`, `Soon`, `SymptomSheet`, `Toast`, `TopupCard`, and `VoiceSheet`.

Shared visual systems audited alongside those components: color and type tokens, system light/dark mode, card/control radii, form fields, rings and bars, chart framing, navigation, focus treatment, reduced motion, and narrow-screen overflow.

## Current pass and open review

- Integrated each section's locally cached image into its page header, with a left-side dark gradient and the photo visible on the right; the woodland hero remains on Today.
- Removed the repeated active-profile strip from the global shell; the active person's name remains in the Today greeting and in profile management.
- Reduced the shared card radius and ring diameter, refined dark-theme colors toward the mockup, and simplified the tab icon treatment.
- Converted the plan overview and wellbeing date header to regular theme-aware surfaces.
- Added locally cached header photography for food, movement, care, wellbeing, settings, and assistant routes; Today keeps its existing forest hero.
- Updated the Today greeting to use the active profile name and exact day-part text without punctuation; recent meals now filter through breakfast/lunch/dinner/snack tabs and can be favorited with a red heart.
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

### Manual visual checks

| Screen | Viewport / theme | Observation |
|---|---|---|
| Today | 390 px / dark | The woodland header, greeting area, week strip, quick actions, and bottom navigation render without clipping. Detailed comparison below the fold remains pending. |
| Add food | 320 px / dark | All four input modes fit. Recent meal cards use local photos for oatmeal/grains, chicken, vegetables, and wraps; the remaining categories still use illustrations. |
| Doctor plan | 390 px / dark | Shared theme and card styling render consistently. The existing single-plan content and demo-data warning differ from the mockup's multi-plan list; the mockup does not authorize adding new plan-management behavior. |
| Progress | 390 px / dark | The weight trend is a responsive line chart. The top-level content order and metric summary still differ from the mockup. |
| Profiles | 390 px / dark | Local profile creation and same-profile device connection are visible. The mockup's shared-access controls and per-person portraits are not implemented. |
| Settings | 390 px / dark | The local profile-photo upload and settings links are visible. The mockup's consolidated settings controls are distributed across existing routes. |
| Add food | 320 px / light | The photo, voice, text, and label-scan actions remain visible below the photographic header; no horizontal overflow. |
| Assistant | 390 px / dark | The image is part of the rounded header, with the title and description legible on the darkened left. |
| Settings | 768 px / dark | The profile-photo card and settings links render beneath the integrated header; no clipping or horizontal overflow. |
| Workout | 1024 px / light | The image is integrated into the header; the previous/next controls remain legible against their surface buttons. |
| Add food | 390 px / light and dark | Recent meal categories and favorite controls are present. Oatmeal, chicken, vegetable, and wrap rows now use cached food photographs; eggs, fish, dairy, fruit, and soup still use category illustrations. |

The expanded E2E matrix initially found horizontal overflow on Motivation at 320 px. Habit labels and right-hand status text now have explicit shrink/wrap constraints; all checks passed on PR #28.

The browser matrix captured every routed screen at 320, 390, 768, and 1024 px in both themes. It verifies header-image presence, visibility, and horizontal overflow; it is not a pixel-level comparison against every mockup. Food cards use local category illustrations as image-like thumbnails; the section header photos do not replace the per-food photographs shown in mockups.

Still to do: inspect every route's screenshots in all eight viewport/theme combinations against the references; resolve remaining component-level differences; record any deliberate differences caused by functionality/accessibility; and wait for green PR CI before merging. Local typecheck, unit, production build, and full E2E have passed.
