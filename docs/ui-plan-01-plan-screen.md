# UI-PLAN-01 — full plan and source context

Stacked on UI-DAY-02 (#168). This stage changes the plan overview and its entry points; existing prescription, diet, goal, follow-up, document-review and clinic-activation handlers remain in place.

- The home heading uses the shared mint vocabulary «Мій план». «Додати план» opens a keyboard-accessible sheet with existing document-photo/image-file, clinic QR-link and manual-entry routes. QR redemption remains the existing camera-opened clinic link flow; this change does not claim an in-browser QR scanner or PDF support.
- A read-only source panel shows the current saved plan and only the active profile's separate source-plan metadata. Draft, active, paused, completed and archived labels reflect stored status, not inferred medical validity. It does not prepare migrations or activate sources.
- Legacy free-text source names remain unverified. For clinic receipts the issuing member/organization is shown separately from the unverified author in the source. A locally retained receipt is not presented as a portable signature or proof of professional qualifications.
- The schedule shows the current plan's stored times, dose, food conditions, PRN status and course dates, linking to the existing editor. It does not treat every catalog source as a daily obligation or tell the person to take an overdue dose.
- Existing section previews keep prescriptions, restrictions, targets/modes and follow-ups reachable. Plan history stays on its existing separate route. Empty clinic-draft panels no longer take space; actual received drafts retain full text review and explicit activation.

No storage schema, medical scheduling rule, entitlement, remote-processing consent, clinic authorization, report-consent or sync behavior is changed. Disabled modules do not delete the underlying plan or its history.

## Verification

Client suite: 769/769 passed; TypeScript and production build passed. Initial plan/import regression run: 26 passed, with two obsolete navigation assertions subsequently corrected. The Today record-history assertion was fixed in #168 and rerun as part of an 11/11 browser pass. The plan retry/back-link assertion was scoped to the main content and rerun successfully. Six final plan/clinic checks passed, including two real clinic issue → QR → patient-draft scenarios, retry cancellation, source/profile isolation and zero data mutation. Plan geometry was checked at 320, 375, 390, 430, 768, 1024 and 1440 px in both themes.

Remote CI and protected-preview verification are checked on the published head. UI-ACTION-01 and UI-RESULTS-01 remain separate stages.
