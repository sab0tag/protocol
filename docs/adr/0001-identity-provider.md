# ACCESS-01-IDP — identity provider for staff and optional patient accounts

Status: accepted for implementation, 2026-10-29. Selected provider: managed Auth0, EU tenant.
No provider account, paid subscription, external credentials or production setting has been created by this ADR.

## Fixed boundaries

- OIDC Authorization Code + PKCE through a backend session boundary, state/nonce validation, exact issuer/subject
  identity, short-lived login attempts and Secure/HttpOnly cookies. No provider access token in browser storage.
- Mandatory MFA for clinic staff; verify the actual authentication assurance, not just a boolean from the UI.
- Provider owns credentials, recovery and MFA. Protocol owns clinic membership, role sets, patient ownership,
  scopes, consents, expiry/revocation and the audit of clinical access. Do not create an identity tenant per clinic
  or depend on provider-specific organization features to decide patient access.
- No medical records, clinical documents, plan content or patient profile details go to the identity provider.
  Login identifiers and authentication metadata are still personal data and need a deliberate hosting choice.
- Patient local-only use stays available without login. Existing staff tokens are not sufficient proof to claim
  an OIDC identity or to merge provisional accounts. Migration needs an explicit invitation/verification flow.
- Provider roles/claims never bypass the live membership and object policy in Protocol. Disabling staff takes
  effect at the next protected operation even when an identity-provider session remains valid.

## Options

| Option | Benefits for Protocol | Cost/operations and remaining checks |
| --- | --- | --- |
| Managed Auth0, EU tenant | Managed credential/MFA operations; EU tenant locality; standard OIDC integration | Pro MFA is a paid-plan entitlement. Approve the actual plan/budget before live use; verify selected factors, recovery, MFA claims, region and DPA. Keep clinics in Protocol rather than buying organization-specific authorization features. |
| Self-hosted Keycloak | Control hosting and identity infrastructure; standard OIDC/MFA; no dependency on an identity SaaS tariff | Operate a separate production database, TLS, email delivery, patches, monitoring, backups and recovery. Production must not use start-dev or the development file database. Assign an operational owner and infrastructure capacity before launch. |
| Managed ZITADEL, EU instance | Standard OIDC, MFA/passkeys; cloud and self-hosted deployment choices | Published pricing/detail pages advertise regional choice, while the customer-portal help page says specific region selection is a Pro feature. Confirm the exact tier/region in the actual portal/contract before promising a free EU deployment. No automatic paid upgrade. |

Use managed Auth0 EU for the initial staff pilot. This avoids operating a second authentication service while
Protocol's clinic/patient integration is being completed. Keep authorization in Protocol and standard OIDC at the
identity boundary. Keycloak remains an alternative if hosting requirements change; switching providers requires
an explicit identity-linking migration and an updated ADR, not merely changing an issuer URL.

This accepts the provider and development direction. It does not authorize a paid plan or activate a tenant.
Select the EU region when creating the tenant; Auth0 does not support moving an existing tenant between regions.
Confirm actual MFA entitlement and cost before provisioning. TOTP through an authenticator is the proposed pilot
factor; assurance claims and recovery must be verified against the selected plan before real staff login.

## Account scope and cost model

Use the same Auth0 EU provider for optional patient sign-in and staff sign-in. One Protocol Account may own a
personal adult profile and multiple clinic memberships; logging into the personal context creates no clinical
permission. Local-only patients do not register and remain independent of identity-provider availability.

The initial login cohort is staff; remote patient binding is not enabled until ACCESS-06. Do not extrapolate a
staff-only quote to the patient rollout: budget for the union of active signed-in staff and patients, counting a
person with both contexts once according to the contracted MAU definition. Local anonymous users are outside this
identity cohort. No production MAU count or budget has been approved. Before enabling patient sign-in, compare
actual pricing at 100, 1,000 and 10,000 patient MAU plus staff, including MFA factors and recovery costs. These are
planning scenarios, not a committed cohort size or tariff promise.

## Fresh authentication and invitations

For role changes, adult-profile binding, grant creation/extension and account deletion, the BFF requires a
verified authentication time no older than 600 seconds. If stale or absent, request re-authentication with
`max_age=600` / `prompt=login`; validate the signed ID token's `auth_time` server-side using the OIDC library.
Provider SSO alone must not refresh the local assurance timestamp. Reject missing/future/out-of-window claims;
use an explicitly bounded clock skew and tests. Recheck freshness at the protected service operation.

For Auth0 staff login/step-up, require `amr` to contain `mfa` in the cryptographically verified ID token. Requesting
an MFA `acr_values` value is a challenge request, not proof of completion. Missing/insufficient assurance denies
clinical access and requires a new challenge; no UI boolean or client claim can override it. Patient-only fresh
login may use the available account verification method; it does not inherit the staff MFA/clinical permission.
Before launch, test missing `amr`, stale/missing `auth_time`, remembered-browser/SSO flows and callback replay with
the actual tenant. For another provider, name and test its precise assurance mapping in a revised ADR.

Protocol owns the 72-hour invitation secret, lifecycle, recipient address, selected membership/roles and
acceptance transaction. Protocol's mail adapter sends the membership invitation. The IdP sends its own address
verification/recovery messages and proves the verified address; its organization/invitation features never grant
membership. No invitation email is sent by this ADR, and a delivery provider still needs separate configuration.

## Identity deletion and hosting alternatives

| Option | Per-person deletion and remaining data terms |
| --- | --- |
| Selected Auth0 EU | Delete the exact external user through the Management API. Confirm deletion completion, authentication-log retention and backup expiry in the actual plan/DPA before live use; API success is not a promise of immediate erasure from all backups. |
| Self-hosted Keycloak | Admin REST user deletion; Protocol's operator owns deletion processing, logs, backup retention/expiry and restoration safeguards. Define and test these operational timelines before choosing this option. |
| Managed Keycloak in the EU | A viable middle option if vendor contracts cover EU placement, patches, support, MFA/recovery, per-user deletion and backup expiry; review the actual supplier/price before selection. It is not provisioned or selected here. |
| ZITADEL Cloud | User v2 Delete User API marks the user deleted. Verify remaining event/log retention and backup timelines in the selected service agreement; do not infer total backup erasure from API deletion. |

A Protocol deletion flow first revokes local/server sessions and disables access, then tracks provider deletion
with retries and confirmation. Keep the disabled identity mapping while deletion is pending so stale provider
sessions cannot recreate access. Clinical receipt/audit retention is a separate Protocol policy, not something
an IdP deletion API implicitly implements. No provider deletion or destructive operation is performed by this ADR.
The exact contractual deletion timeline and backup expiry are pre-enablement gates, not assumed vendor facts.

## Acceptance before enabling a real login

1. Provider is selected: managed Auth0 EU. Before provisioning, assign tenant administration and confirm the actual
   MFA plan/budget. Any paid plan or infrastructure purchase is separately approved before activation; writing the
   adapter does not authorize spending.
2. Record issuer, hosting region, application/client type and operator ownership. Keep secrets in the existing secret
   mechanism, never source, CI fixtures, chat or browser localStorage.
3. Test MFA enrollment, challenge, recovery and assurance claims with synthetic staff. Determine the actual MFA
   entitlement, session lifetime and account recovery behavior, not only the marketing plan description.
4. Verify state/nonce/PKCE, callback/redirect allowlist, CSRF, logout/revoke-all and disabled-member denial. An old
   bearer token, matching email or display name cannot claim another account.
5. Record the serving topology before callback/cookie integration: the current app and API use separate hosts;
   use an explicitly reviewed same-origin proxy/BFF or a narrowly allowed same-site API configuration. Do not widen
   CORS, cookie Domain, deployment visibility or production routes silently to make login work.
   **Recorded 2026-10-29: same-site API** — sign-in and callback on `api.beyondthesignal.to`, `__Host-` cookies of the
   API host (no `Domain`), credentialed CORS on `/v1/session*` and, from ACCESS-04-A, protected `/v1/clinic/*`
   only for the exact app origin. Anonymous `/v1/clinic/plans/redeem` remains non-credentialed. See
   [ACCESS-03](../access-03-sessions.md).
6. Confirm the MAU cohort/plan, per-person deletion completion and provider backup/log retention terms, identifier
   region, Protocol invitation delivery, key/JWKS rotation and recovery drill. Verify the 10-minute step-up contract
   and Auth0 `amr`/`auth_time` handling described above.
   Export/retirement of the provider must preserve Protocol account IDs and not affect local patient access.

ACCESS-02 and ACCESS-05 are already merged. This accepted provider decision allows ACCESS-03 implementation and
local synthetic OIDC/MFA tests to proceed. Real tenant provisioning and production login remain disabled until the
operational gates above are satisfied. No bypass of session, MFA or object policy is allowed in the interim.

## Primary sources checked

- Auth0 tenant locality: https://support.auth0.com/center/s/article/Tenant-Creation-in-a-Specific-Sub-region
- Auth0 region changes: https://support.auth0.com/center/s/article/Change-the-Location-of-Existing-Tenant
- Auth0 MFA entitlements: https://support.auth0.com/center/s/article/Entitlements-for-Enterprise-MFA-Feature
- Auth0 MFA assurance: https://support.auth0.com/center/s/article/configure-auth0-for-salesforce-multi-factor-authentication-compliance
- OIDC claim/state/nonce checks: https://github.com/panva/openid-client/blob/main/docs/interfaces/AuthorizationCodeGrantChecks.md
- Auth0 individual deletion: https://support.auth0.com/center/s/article/Deleting-Inactive-Users
- Keycloak user deletion: https://www.keycloak.org/docs-api/latest/rest-api/
- ZITADEL user deletion: https://zitadel.com/docs/reference/api/user/zitadel.user.v2.UserService.DeleteUser
- Auth0 pricing (recheck before purchase): https://auth0.com/pricing
- Keycloak production requirements: https://www.keycloak.org/server/configuration-production
- Keycloak containers: https://www.keycloak.org/server/containers
- Keycloak databases: https://www.keycloak.org/server/db
- ZITADEL deployment/MFA: https://zitadel.com/docs
- ZITADEL pricing: https://zitadel.com/pricing and https://zitadel.com/pricing/detail
- ZITADEL portal region/tier caveat: https://help.zitadel.com/customer-portal-instances

No numeric budget is assumed. Sources and vendor entitlements can change; recheck at provisioning time.
