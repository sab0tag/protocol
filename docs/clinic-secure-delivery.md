# Clinics: secure delivery design (MVP)

This document defines the security boundary for the next PR. It does not activate an endpoint.

## Actors
- Clinic doctor creates a draft and explicitly issues a final plan.
- Patient imports a plan into local storage only after reviewing it.
- Clinic administrator manages staff, not patient diaries.

## Delivery
1. Authenticate doctor and authorize their tenant and issue-plan permission.
2. Persist a versioned plan with a fixed expiry and encrypted-at-rest temporary payload.
3. Generate a cryptographically random, single-use bearer token (>=256 bits); store only its hash.
4. Display QR containing HTTPS URL with token in the URL fragment, not a query string, to minimize accidental logging. Client POSTs token to redeem endpoint over TLS.
5. Redeem atomically: validate expiry, organization and issuance status, consume token once, return only plan preview.
6. Patient reviews all medications, doses, frequencies, durations and constraints before importing.
7. Explicit patient confirmation commits a new local plan; no server-side automatic activation.
8. Delete temporary payload on redemption or expiry according to retention policy.

## Abuse cases to test
- Replay, concurrent double redemption, expired/revoked tokens.
- Cross-tenant access and doctor role escalation.
- Link preview bots must not consume a token via GET.
- Server access logs must not include token or medical content.
- Plan payload tampering and untrusted clinician attribution.
- Browser history, analytics and third-party scripts must not receive token.
- Patient declines import; nothing is activated.
- Missing network or unavailable clinic service leaves existing local plan intact.

## Privacy and launch gate
No patient diary data returns to the clinic. Real medical data, credentials and access tokens must not appear in source control, CI fixtures or analytics. Legal/privacy review and threat-model sign-off required before a real-patient pilot.

## Status after ACCESS-00-H (access TZ v1.2)
Delivered on the existing staff-token model, without DDL:
- `status`/`revoke` filter by `id + org + issued_by`. A colleague in the same clinic and another clinic both get 404 and the row is unchanged.
- `redeem` runs in one `BEGIN IMMEDIATE` transaction: read, status change, payload erase and the `patient_link` audit entry. The plan is returned only after commit. The API connection sets `busy_timeout = 5000`.
- HTTP contract: `invalid` 404, `used` 409 (always), `expired`/`revoked`/`tampered` 410, busy lock 503 `database_busy` with `Retry-After: 1`. The rate-limit counter write maps a busy lock to the same 503.
- A payload that fails verification (missing, hash, JSON, schema, organization) ends in the terminal `tampered` state, committed together with the erase and one audit entry carrying only the delivery id and the category.

Known limitations, still open:
- A response lost after commit is not recoverable (ACCESS-07-C, AC-12). The patient must ask for a new code.
- The payload is still plaintext until it is erased (ACCESS-07-B). The issuer name is still client-supplied (ACCESS-07-A, AC-17).
- `node:sqlite` is synchronous: waiting up to 5 s for a lock held by another process (today mainly `clinic:create`) stalls the whole API event loop. Accepted for the pilot; no automatic retries. Other API writes outside the clinic routes still surface a busy lock as 500.

