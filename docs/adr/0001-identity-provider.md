# ACCESS-01-IDP — identity provider for staff login

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
6. Confirm identifier/auth-log retention and region, invitation/email delivery, key/JWKS rotation and recovery drill.
   Export/retirement of the provider must preserve Protocol account IDs and not affect local patient access.

ACCESS-02 and ACCESS-05 are already merged. This accepted provider decision allows ACCESS-03 implementation and
local synthetic OIDC/MFA tests to proceed. Real tenant provisioning and production login remain disabled until the
operational gates above are satisfied. No bypass of session, MFA or object policy is allowed in the interim.

## Primary sources checked

- Auth0 tenant locality: https://support.auth0.com/center/s/article/Tenant-Creation-in-a-Specific-Sub-region
- Auth0 region changes: https://support.auth0.com/center/s/article/Change-the-Location-of-Existing-Tenant
- Auth0 MFA entitlements: https://support.auth0.com/center/s/article/Entitlements-for-Enterprise-MFA-Feature
- Auth0 pricing (recheck before purchase): https://auth0.com/pricing
- Keycloak production requirements: https://www.keycloak.org/server/configuration-production
- Keycloak containers: https://www.keycloak.org/server/containers
- Keycloak databases: https://www.keycloak.org/server/db
- ZITADEL deployment/MFA: https://zitadel.com/docs
- ZITADEL pricing: https://zitadel.com/pricing and https://zitadel.com/pricing/detail
- ZITADEL portal region/tier caveat: https://help.zitadel.com/customer-portal-instances

No numeric budget is assumed. Sources and vendor entitlements can change; recheck at provisioning time.
