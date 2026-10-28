# Marketing landing — PR #48 recovery

- Branch: `feat/marketing-landing-mvp`; application root routing is unchanged.
- Landing: `/landing`, `/landing/`, `/landing/index.html`.
- Explicit Vercel rewrites serve the static HTML. Workbox excludes this route from the app navigation fallback: otherwise a previously installed app worker can replace the bare landing URL with the SPA shell before the network rewrite runs.
- Demo script is same-origin external JavaScript; the existing CSP stays unchanged. Favicon is same-origin too.
- Fixed the ambiguous CTA test by checking both actual CTA links, and restored mobile hero side padding.
- Regression verified: the installed-worker/bare-URL test fails without the Workbox exclusion and passes with it. Vite preview does not apply Vercel rewrites, so this one test applies the configured exact rewrite at the network boundary. Other landing URLs use the built server directly.
- Focused checks: standalone HTML/CSS, both CTAs, demo under deployed CSP, navigation after app worker activation, 320/1440 widths with light/dark OS preferences. Landing deliberately retains its authored light palette in either OS preference.
- Production build/typecheck passed. Full CI and new preview verification pending publication.
- Vercel preview requires authentication in the available cloud browser; no protection settings changed. Main and production untouched.
