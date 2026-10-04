/** Design tokens from SPEC.md §7; values live in CSS variables so the dark theme can swap them. */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'), surface: token('surface'), ink: token('ink'), muted: token('muted'),
        line: token('line'), accent: token('accent'), warn: token('warn'), 'warn-bg': token('warn-bg'),
        water: token('water'),
      },
      fontFamily: { sans: ['"Golos Text"', 'system-ui', '-apple-system', 'sans-serif'] },
      minHeight: { tap: '44px' }, minWidth: { tap: '44px' },
    },
  },
  plugins: [],
};
