# Food entry first slice — 28 October 2026

Owner priority: «Записати їжу» before the broader nutrition hub and recommendations. Branch `feat/protocol-food-entry`, stacked on visual polish PR #44.

Three primary paths: write, photograph, choose prepared food. Voice and label scan remain under an explicit secondary disclosure; detailed composition editing, recent meals, favorites, portions, free entry and sticky confirmation remain. Prepared choices use existing recipe ingredients/portions and only fill the draft; selecting a dish does not record a meal. Full dish catalog stays accessible.

The existing evaluation engine remains authoritative. A presentation helper distinguishes known configured allergens, existing rule attention, incomplete/estimated composition or incomplete diet configuration, and no known conflict. Estimated AI allergens never become a confirmed-allergen claim by presentation alone. Existing ingredient-specific reasons and explanations are retained. The check panel now precedes the composition editor; incomplete items have an explicit uncertainty badge instead of a green yes. Both themes use a red allergen treatment and text labels. Absence of a known conflict is explicitly limited to known composition and entered restrictions, not a medical safety guarantee. No active plan still uses the existing no-plan explanation.

Validation: initial full unit suite 538 passed, build/typecheck passed; six focused browser cases passed for food entry, route naming, label recognition and existing meal recording. Last layout/presentation refinements are covered by the same six cases. Added coverage for preserved rule reasons and allergens in partially unknown recipes; run final checks/CI before marking ready. Mobile dark/light and desktop captures use synthetic foods only.

Remaining: independent daily nutrition hub, richer dish catalog/favorites workflow and «Що мені поїсти?» recommendations. Do not invent cooking time or pantry contents. Protein-gap options need a configured goal and actual day records; plan-based suggestions must reuse complete evaluation and retain uncertainty. The 10–20 second goal is not yet a measured result. No live multi-plan clinical model or caregiver authorization is introduced.

Final local verification: 540 client unit tests passed; clean production build/typecheck passed (49 precache entries, ~2.7 MB); final six focused browser scenarios passed. Check panel position is before composition editing. Remote full CI and preview are still required before declaring the stage complete.
