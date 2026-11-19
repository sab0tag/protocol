/** Design tokens from SPEC.md §7; values live in CSS variables so the dark theme can swap them. */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'), surface: token('surface'), ink: token('ink'), muted: token('muted'),
        line: token('line'), accent: token('accent'), 'on-accent': token('on-accent'), warn: token('warn'), 'warn-bg': token('warn-bg'),
        water: token('water'), ok: token('ok'), 'ok-bg': token('ok-bg'), danger: token('danger'), 'danger-bg': token('danger-bg'),
        pending: token('pending'), 'pending-bg': token('pending-bg'), disabled: token('disabled'),
        paper: token('paper'), scrim: token('scrim'), // D190
      },
      fontFamily: { sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'] },
      minHeight: { tap: '44px' }, minWidth: { tap: '44px' },
      // D190: the type scale in one place — captions never under 13 px, body 16 px, line height 1.45
      fontSize: { xs: ['0.8125rem', { lineHeight: '1.45' }], sm: ['0.875rem', { lineHeight: '1.45' }], base: ['1rem', { lineHeight: '1.45' }] },
    },
  },
  plugins: [],
};
