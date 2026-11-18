# The app built for the demo stand (its own API, the «Демо · дані вигадані» band), served on :80 inside the box's network;
# the box's Caddy fronts it with TLS at protocol-demo.<domain> (demo/Caddyfile.shared).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG DEMO_ROOT
RUN test -n "$DEMO_ROOT" && VITE_API_URL=https://api-protocol-demo.$DEMO_ROOT VITE_DEMO_STAND=1 npx vite build

FROM caddy:2.8
COPY --from=build /app/dist /srv
COPY demo/Caddyfile.web /etc/caddy/Caddyfile
