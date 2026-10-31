# Isolated clinic pilot on Hetzner

This deployment is **not connected to production**. It deliberately has no host ports, no production Docker network, no shared data volume, and no publicly reachable endpoint until the separate Caddy PR is deployed, DNS is configured and CORS is reviewed.

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

The API joins the existing `harch_edge` network (so Caddy and other containers on that network can reach it), but publishes no host port. Merge/deploy the separately reviewed `sab0tag/harch` Caddy change for `api-pilot.beyondthesignal.to`, add DNS and validate TLS. Configure a dedicated pilot frontend pointing to this endpoint and set `ALLOWED_ORIGINS` to that frontend's exact origin. Do not use the production frontend. Never point the production frontend at this test API. The default `CLINIC_IDENTITY_V2=off` supports legacy token testing only. OIDC + MFA and email invitations require a **separate** configuration and review before enabling; do not reuse production IdP or SMTP secrets without approval.

## Deployment order and smoke checks

1. Review and merge the Protocol pilot Compose PR and the Harch Caddy PR independently; neither is auto-deployed by creating the PR.
2. On Hetzner create a separate pilot checkout and `.env.pilot`, then launch the pilot Compose project. Verify `docker compose -p protocol-clinic-pilot -f compose.pilot.yml ps` shows a healthy running API.
3. Add the `api-pilot.beyondthesignal.to` DNS A record pointing to the Hetzner host. Deploy the Harch Caddyfile change and reload Caddy after validating its configuration.
4. Confirm `curl -fsS https://api-pilot.beyondthesignal.to/health` succeeds and the production `https://api.beyondthesignal.to/health` is unaffected. Check TLS and exact-origin CORS.
5. Deploy a separate pilot frontend configured at build time with `VITE_API_URL=https://api-pilot.beyondthesignal.to`. Do not alter the production frontend's API URL.
6. Bootstrap the pilot admin token only in the pilot container. Run synthetic doctor → QR → patient scenarios; test revoke, replay and cross-clinic isolation.

## Acceptance checklist

- [ ] Verify dedicated container and volume; production API and data unchanged
- [ ] API health over private network and approved HTTPS endpoint
- [ ] Bootstrap synthetic admin; add synthetic doctor; verify role isolation
- [ ] Doctor issues a fictional plan; patient redeems QR and explicitly imports
- [ ] Replay, revoke, expired code and cross-clinic access denied
- [ ] Verify report sharing only after explicit patient consent (if implemented)
- [ ] Check logs contain no bearer tokens, QR secrets or patient payloads

**Not yet deployed:** this file does not provision Hetzner, DNS, TLS, credentials, or production rollout.
