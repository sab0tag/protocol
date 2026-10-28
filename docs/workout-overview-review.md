# Workout overview review — 28 October 2026

Base: PR #45, commit 2209235. First overview slice only; focused active session and post-workout summary remain open.

The exercise CTA used a fragment href that replaced the HashRouter route with #workout-exercises. A browser regression reproduced the failure. The fix uses in-page scrolling and heading focus, retaining #/workout and honoring reduced motion. Duration is labeled as planned before logging and recorded afterward; set count wording follows the same distinction.

378 unit tests and build/typecheck passed. Overview regression plus existing workout scenarios: 8/8 browser tests passed, including program changes, progression, delayed AI responses, saving and recoverable drafts. The editor's side-specific set model and controls are untouched. Validate the integrated current-main base before merging #45: this review is stacked on its own source branch, not a replacement for later UI work.

Next product priority from the owner: food entry with text/photo/prepared-food scenarios and explicit restriction reasons/uncertainty. Do not invent preparation time, pantry stock or clinical safety claims.
