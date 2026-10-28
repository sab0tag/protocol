# R5 old-client compatibility gate

This is the server negotiation boundary before normalized encrypted sync, not completion of the normalized transport. The current client explicitly advertises data protocol **1**. Source-plan preparation remains non-authoritative and no multi-plan consumer is enabled.

## Default and opt-in

Existing vaults default to minimum protocol 1. SQLite adds an empty `vault_protocols` table without changing vault authentication, ciphertext, bytes, history or existing schedules. No app startup or UI calls the upgrade endpoint.

Authenticated `GET /v1/vaults/:id/write-protocol` reports the current minimum and server-supported maximum (2). Authenticated `PUT` with `{minimum: 2, protocol: 2}` opts in that vault monotonically. Repeated opt-in is idempotent. Unsupported or unauthenticated claims cannot change the minimum.

After opt-in, legacy record pulls and writes, reminder uploads and reminder-policy writes return `409 client_upgrade_required` before touching data or advancing the client pull cursor. Capable clients use `protocol=2` on record pulls and a numeric `protocol: 2` in affected write bodies. Request metadata does not relax the closed reminder-policy payload: arbitrary extra fields still fail validation. No extra HTTP header/CORS requirement is introduced; current protocol-1 query/body metadata is ignored by older servers.

The first transition retires the vault's old queued schedules in the same SQLite transaction as the floor change. Ciphertext, acknowledgement history, preferences, subscriptions and other vaults remain intact. A capable client must submit its fresh schedule. Repeating the opt-in preserves that newly submitted queue. Push processing rechecks the protocol between awaited sends and never deletes/updates a new queue from an obsolete due snapshot. An already dispatched push cannot be recalled; actual sent history is retained.

The gate is cooperative client-version compatibility, not a new permission system. Possessing the vault authorization key still grants its existing scope; it does not create caregiver authorization. A future normalized adapter may advertise protocol 2 only after it handles the complete schema, ownership, atomic versions and conflicts. Merely changing the advertised number is unsafe and is not done here.

## Deployment and rollout

1. Deploy the checked server build, leaving every vault at floor 1. Main/Vercel publication does not deploy the independent Hetzner API container. README documents the existing `server/` rsync + Docker Compose procedure; secrets stay in the server's existing environment.
2. Verify negotiation and legacy sync on a synthetic test vault, plus record/push isolation. Do not opt real vaults into floor 2 before the normalized client adapter and conflict recovery are accepted.
3. Ship that capable client behind a default-off rollout flag, verify full schema support, then explicitly opt selected test vaults into floor 2 before writing normalized data.
4. Once a vault opts in, do not roll the API back to a binary that ignores the floor. Keep gate enforcement during rollback. The current default-off release has not opted any real vault in.

No production server deployment, real-vault upgrade, credential access or medical-data publication is performed by this change.

## Verification

73 server tests and server typecheck passed, including seven new cases: legacy defaults/authentication, denied reads/writes without ciphertext/seq/byte mutations, isolated vaults, capable-client retry, malformed claims, transactional rollback, push-snapshot race and historical SQLite reopening/persistence. Client suite 534 passed; build/typecheck passed. Three browser cases passed: existing sync, source-plan backup and the real API opt-in rejection with a visible upgrade message and unchanged cursor/ciphertext. The error state is captured at 320/1024 light/dark with synthetic records only. CI/preview is recorded in the PR.
