#!/bin/sh
# First setup of the demo stand on its own VPS: secrets and the mail trap's certificates, once. Usage: sh demo/setup.sh demo.<domain> [acme e-mail]
# Writes demo/.env and demo/.secrets/ (both ignored by git). Prints no secret.
set -eu
DOMAIN="${1:?usage: sh demo/setup.sh demo.<domain> [acme e-mail]}"
case "$DOMAIN" in demo.*) ;; *) echo "the demo stand lives on demo.<domain> only" >&2; exit 1 ;; esac
cd "$(dirname "$0")"
mkdir -p .secrets && chmod 700 .secrets
if [ ! -f .secrets/ca.crt ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=Protocol demo mail CA" -keyout .secrets/ca.key -out .secrets/ca.crt 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -subj "/CN=mailpit" -keyout .secrets/mailpit.key -out .secrets/mailpit.csr 2>/dev/null
  printf 'subjectAltName=DNS:mailpit\n' > .secrets/san.ext
  openssl x509 -req -in .secrets/mailpit.csr -CA .secrets/ca.crt -CAkey .secrets/ca.key -CAcreateserial -days 825 -extfile .secrets/san.ext -out .secrets/mailpit.crt 2>/dev/null
  rm -f .secrets/mailpit.csr .secrets/san.ext
fi
if [ ! -f .env ]; then
  SMTP_PASS=$(openssl rand -hex 24); CLIENT_SECRET=$(openssl rand -hex 32)
  printf 'demo:%s\n' "$SMTP_PASS" > .secrets/smtp-auth
  cat > .env <<ENV
DEMO_DOMAIN=$DOMAIN
ACME_EMAIL=${2:-}
STAFF_SMTP_PASSWORD=$SMTP_PASS
OIDC_CLIENT_SECRET=$CLIENT_SECRET
DEMO_IDP_CLIENT_SECRET=$CLIENT_SECRET
# optional: an AI key of its own for the demo (photo, menu, assistant); empty — those features are off on the stand
ANTHROPIC_API_KEY=
ENV
  chmod 600 .env
fi
# readable inside the containers (they run as other users); on the VPS .secrets/ (700) keeps them from other accounts
chmod 644 .secrets/ca.crt .secrets/mailpit.crt .secrets/mailpit.key .secrets/smtp-auth; chmod 600 .secrets/ca.key
echo "demo stand configured for $DOMAIN — DNS: $DOMAIN, api.$DOMAIN, idp.$DOMAIN → this VPS"
