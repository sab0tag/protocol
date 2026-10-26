# Protocol 2.0 — forest design pass

Branch: `ui-ux/protocol-v2-forest-system`, based on the locally validated food slice (`fcc31e1`) above PR #18. This checkpoint is local; it does not describe a production deployment.

The user's visual correction was explicit: recognizable fir trees, the shared toggle/progress treatment, and less crowded working screens in the mood of the earlier forest mock.

## Implemented

| Surface | Result |
| --- | --- |
| Today | Photographic fir forest replaces CSS polygons; food/voice action follows the calendar; summary precedes the timeline. |
| Water/medicines dock | Water has a reserved row while quick actions are visible. Scrolling brings back the floating controls. The same save, accumulated feedback, and undo remain. Feedback wraps within narrow screens. |
| Metrics | Spacious metric tiles, bounded accessible rings and bars, real values in text. No completion ring without a configured target. Carbohydrate limits retain neutral/warning treatment and the explanation that a limit is not a goal. |
| Working headers | Shared local forest scene for Food, Progress, More/categories, Wellbeing, Assistant, Week, Motivation, Sync/Reminders, Menu/Shopping/Dishes, and supporting tools. Plan overview uses the same scene. |
| Controls | Native keyboard-operable checkboxes styled as switches for binary settings; document/ingredient selections remain square checkboxes. Labels, checked state, disabled state, and handlers remain native. |
| Wellbeing | Separate score cards with clear selected states, roomy five-step groups and quiet scale labels; autosave remains visible. |
| Week/My day | Habit and checklist tracks derive from existing known counts. No invented overall health score. |
| Shared surfaces | Woodland light/dark tokens, consistent cards, navigation selection, form fields and sheets across existing routes. Mobile Menu dates/day counts stack; weight-entry actions get their own row. |

The inherited Food slice includes compact favorites, three distinct recent completed meals copied into editable drafts, a reachable save action and a sufficiently wide quantity field. Its acceptance details remain in `protocol-v2-food.md`.

## Review images

These are browser captures of the production build using the application's explicitly labelled, invented example database, not new generated UI mockups or patient data.

- [Today viewport](previews/forest-today-viewport.png)
- [Today full page](previews/forest-today.png)
- [Food](previews/forest-food.png)
- [More](previews/forest-more.png)
- [Wellbeing](previews/forest-wellbeing.png)
- [Progress](previews/forest-progress.png)
- [Reminders and native toggles](previews/forest-reminders.png) — isolated browser-test fixture; no push subscription was enabled.

Full-page captures retain the fixed navigation at the initial viewport position, as Chromium captures it.

## Asset provenance

- Final project asset: `src/assets/forest-dusk.webp`, 1536 × 1024, 104,436 bytes.
- Mode: built-in image generation with an earlier forest mock as a mood/composition reference; opaque photograph/background asset only. The generated PNG was encoded as WebP for delivery.
- Source of UI: React/CSS. The generated image contains no text, charts, controls or app frame.
- The image is bundled locally and included in the service worker precache (`webp` added to Workbox glob patterns); there is no runtime image-host dependency.

Exact image-generation prompt:

> Use case: photorealistic-natural. Create a production website background asset only, no interface, no text. Reference image is a mood reference: evening mountain forest behind a calm Ukrainian health journal app. Make a high-quality very wide landscape photograph: layered misty Carpathian mountains and clearly recognizable elegant spruce/fir tree silhouettes, a tall natural conifer at the right edge and several shorter firs across the lower edge. Dusk sky, muted warm apricot light near the right horizon, deep desaturated forest greens, charcoal teal shadows. Refined atmospheric photographic texture, natural needles and branches, realistic mountains rather than polygons. Composition: left 65% and upper-middle area calm dark low-detail negative space for white app text and calendar overlays, light brightest only in top-right/middle-right sky. Trees especially recognizable on right and lower edges without dominating all content. Subtle cinematic haze, no people, no buildings, no roads, no logos, no watermarks, no writing, no mockup frame. Broad 3:2 landscape asset suitable for cropping to a 2:1 rounded app header on desktop and 1.15:1 header on mobile. Keep enough dark trees visible after mobile crop. Image must look like the forest scene in the mood reference, without copying any typography or UI.

## Validation and boundaries

- TypeScript check and production build pass; 378 client unit tests pass.
- Browser audit covers 35 routes at 320 × 568 dark, 390 × 844 light and 1024 × 768 dark. Each screen must load its heading, preserve navigation and fit the viewport horizontally.
- Added acceptance checks for offline image retrieval after reload, primary action visibility on a narrow phone, summary-before-timeline order, actual over-limit values with bounded meters, no fictional percentages without targets, and keyboard toggle persistence for plan/reminder settings.
- Existing photo-redaction coordinate test now scrolls the photo into view before dragging. Its assertions still verify the exact transmitted pixels after redaction and crop.
- Full browser run: 85 of 86 passed. The photo-redaction coordinate test failed because the enlarged layout left its drag point outside the visible photo. After adding the explicit scroll, the unchanged redaction/pixel assertions passed with `npm run e2e -- --last-failed` (1/1). All 86 scenarios have therefore been exercised successfully; this is not a claim of a second full 86/86 run.

This is a shared visual/interaction pass, not completion of every release in the Product/UX/Architecture TZ. Multi-plan storage, full document provenance/edit verification, admin/caregiver access and the separate explicit-import-time branch are not introduced by this branch. Existing medical rules and safety cards remain in place. OS notification delivery, actual camera input and OCR/model quality still need device/service checks.
