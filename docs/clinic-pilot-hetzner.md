# Isolated clinic pilot on Hetzner

This deployment is **not connected to production**. It deliberately has no host ports, no production Docker network, no shared data volume, and no publicly reachable endpoint until an operator configures a TLS reverse proxy and reviews CORS.

## Prepare

On the Hetzner host, clone/update the repository into a separate working directory. In `server/`, create `.env.pilot` (never commit it), with `ALLOWED_ORIGINS` set to the exact dedicated pilot frontend origin. Leave third-party AI keys empty. Do not copy production secrets or medical data. The Docker image uses Node 24 and the API migrates its own empty pilot DB on first startup.

```sh
cd server
mkdir -p pilot-backups
chmod 700 pilot-backups
docker compose -p protocol-clinic-pilot -f compose.pilot.yml up -d --build
docker compose -p protocol-clinic-pilot -f compose.pilot.yml ps
docker compose -p protocol-clinic-pilot -f compose.pilot.yml logs --tail=50 pilot-api
```

## Bootstrap first administrator (legacy pilot only)

```sh
docker compose -p protocol-clinic-pilot -f compose.pilot.yml exec pilot-api npm run clinic:create -- "Protocol Pilot Clinic" "Test Admin"
```

The command prints the clinic ID and administrator token **once**. Capture privately; never paste it into CI logs, issues, chat or source control. The administrator opens the dedicated pilot frontend `#/clinic`, enters the temporary token, and creates a synthetic doctor with the UI; that token is also displayed once. Use only fictional prescriptions.

## HTTPS exposure and identity

The default `pilot_edge` network is internal: no external connections and no public port. To expose the pilot, an operator must explicitly connect an HTTPS proxy to this isolated network, configure a dedicated DNS name, TLS, CORS and a pilot frontend pointing to that endpoint. Never point the production frontend at this test API. The default `CLINIC_IDENTITY_V2=off` supports legacy token testing only. OIDC + MFA and email invitations require a **separate** configuration and review before enabling; do not reuse production IdP or SMTP secrets without approval.

## Acceptance checklist

- [ ] Verify dedicated container and volume; production API and data unchanged
- [ ] API health over private network and approved HTTPS endpoint
- [ ] Bootstrap synthetic admin; add synthetic doctor; verify role isolation
- [ ] Doctor issues a fictional plan; patient redeems QR and explicitly imports
- [ ] Replay, revoke, expired code and cross-clinic access denied
- [ ] Verify report sharing only after explicit patient consent (if implemented)
- [ ] Check logs contain no bearer tokens, QR secrets or patient payloads

**Not yet deployed:** this file does not provision Hetzner, DNS, TLS, credentials, or production rollout.
