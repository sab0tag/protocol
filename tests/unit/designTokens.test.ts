import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');

type Rgb = [number, number, number];

/** The token declarations of one theme block, e.g. the light `:root { … }` or `:root[data-theme="dark"] { … }`. */
function tokens(opener: string): Record<string, Rgb> {
  const start = css.indexOf(opener);
  if (start < 0) throw new Error(`no block ${opener}`);
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, Rgb> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(\d+) (\d+) (\d+);/g)) out[m[1]!] = [Number(m[2]), Number(m[3]), Number(m[4])];
  return out;
}

const luminance = ([r, g, b]: Rgb) => {
  const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const themes = {
  light: tokens(':root {\n  --bg'),
  dark: tokens(':root[data-theme="dark"] {'),
};
// [foreground, background, what it is]: text pairs the interface actually uses (WCAG 2.1 AA, 4.5:1)
const pairs: Array<[string, string, string]> = [
  ['ink', 'bg', 'body text'], ['ink', 'surface', 'text on a card'], ['muted', 'bg', 'secondary text'],
  ['muted', 'surface', 'secondary text on a card'], ['accent', 'surface', 'accent text on a card'],
  ['bg', 'accent', 'primary action label'], ['warn', 'warn-bg', 'warning state'], ['ok', 'ok-bg', 'done state'],
  ['danger', 'danger-bg', 'error state'], ['pending', 'pending-bg', 'waiting state'],
];

describe('design tokens meet WCAG AA in both themes', () => {
  for (const [theme, set] of Object.entries(themes)) {
    for (const [fg, bg, what] of pairs) {
      it(`${theme}: ${what} (${fg} on ${bg})`, () => {
        expect(set[fg], `${fg} defined`).toBeDefined();
        expect(set[bg], `${bg} defined`).toBeDefined();
        expect(contrast(set[fg]!, set[bg]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('the system dark theme uses the same values as the explicit one', () => {
    const system = tokens(':root:not([data-theme]) {\n    --bg');
    for (const name of Object.keys(themes.dark)) expect(system[name], name).toEqual(themes.dark[name]);
  });
});
