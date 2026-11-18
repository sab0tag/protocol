# The app built for the demo stand (its own API, the «Демо · дані вигадані» band) behind Caddy, which also fronts the API
# and the mock identity provider with TLS.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG DEMO_DOMAIN
RUN test -n "$DEMO_DOMAIN" && VITE_API_URL=https://api.$DEMO_DOMAIN VITE_DEMO_STAND=1 npx vite build

FROM caddy:2.8
COPY --from=build /app/dist /srv
COPY demo/Caddyfile /etc/caddy/Caddyfile
