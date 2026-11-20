import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/styles/index.css'), 'utf8');

/** The token declarations of one theme block, e.g. the light `:root { … }` or `:root[data-theme="dark"] { … }`. */
function tokens(opener) {
  const start = css.indexOf(opener);
  if (start < 0) throw new Error(`no block ${opener}`);
  const body = css.slice(start, css.indexOf('}', start));
  const out = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(\d+) (\d+) (\d+);/g)) out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  return out;
}

const luminance = ([r, g, b]) => {
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const themes = {
  light: tokens(':root {\n  --bg'),
  dark: tokens(':root[data-theme="dark"] {'),
};
// [foreground, background, what it is]: text pairs the interface actually uses (WCAG 2.1 AA, 4.5:1)
const pairs = [
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
        expect(contrast(set[fg], set[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('the system dark theme uses the same values as the explicit one', () => {
    const system = tokens(':root:not([data-theme]) {\n    --bg');
    for (const name of Object.keys(themes.dark)) expect(system[name], name).toEqual(themes.dark[name]);
  });
});

// D163: direction C (src/styles/palette-c.css) — the spec's pairs: text 4.5:1, borders and the water meter 3:1.
const paletteC = readFileSync(join(process.cwd(), 'src/styles/palette-c.css'), 'utf8');
function block(source, opener) {
  const start = source.indexOf(opener);
  if (start < 0) throw new Error(`no block ${opener}`);
  const body = source.slice(start, source.indexOf('}', start));
  const out = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(\d+) (\d+) (\d+);/g)) out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  return out;
}
const withBase = (base, over) => ({ ...base, ...over });

describe('direction C meets the spec\'s contrast in both themes (D163)', () => {
  const c = {
    light: withBase(themes.light, block(paletteC, ':root[data-palette="c"] {')),
    dark: withBase(themes.dark, block(paletteC, ':root[data-palette="c"][data-theme="dark"] {')),
  };
  const large = [['line', 'surface', 'field and button border'], ['line', 'bg', 'border on the screen'], ['water', 'surface', 'water meter'],
    ['accent', 'surface', 'main action on a card']];
  const text = [...pairs, ['on-accent', 'accent', 'label on the main action'], ['on-accent', 'ok', 'label on «Прийняв»'], ['muted', 'warn-bg', 'secondary text on a plan remark']];
  for (const [theme, set] of Object.entries(c)) {
    for (const [fg, bg, what] of text) it(`${theme}: ${what} (${fg} on ${bg}) ≥ 4.5`, () => expect(contrast(set[fg], set[bg])).toBeGreaterThanOrEqual(4.5));
    for (const [fg, bg, what] of large) it(`${theme}: ${what} (${fg} on ${bg}) ≥ 3`, () => expect(contrast(set[fg], set[bg])).toBeGreaterThanOrEqual(3));
  }
  it('the system dark theme uses the same values as the explicit one', () => {
    const system = block(paletteC, ':root[data-palette="c"]:not([data-theme]) {');
    expect(system).toEqual(block(paletteC, ':root[data-palette="c"][data-theme="dark"] {'));
  });
  it('danger stays the only red: direction C does not redefine it', () => {
    expect(block(paletteC, ':root[data-palette="c"] {').danger).toBeUndefined();
  });
});

// D198: direction 01 «Сітка» (src/styles/palette-grid.css) — the same pairs as C; the action is not red, danger stays the only red.
const paletteGrid = readFileSync(join(process.cwd(), 'src/styles/palette-grid.css'), 'utf8');
describe('direction 01 «Сітка» meets the same contrast in both themes (D198)', () => {
  const g = {
    light: withBase(themes.light, block(paletteGrid, ':root[data-palette="grid"] {')),
    dark: withBase(themes.dark, block(paletteGrid, ':root[data-palette="grid"][data-theme="dark"] {')),
  };
  const large = [['line', 'surface', 'field and button border'], ['line', 'bg', 'border on the screen'], ['water', 'surface', 'water meter'],
    ['accent', 'surface', 'main action on a card']];
  const text = [...pairs, ['on-accent', 'accent', 'label on the main action'], ['on-accent', 'ok', 'label on «Прийняв»'], ['muted', 'warn-bg', 'secondary text on a plan remark']];
  for (const [theme, set] of Object.entries(g)) {
    for (const [fg, bg, what] of text) it(`${theme}: ${what} (${fg} on ${bg}) ≥ 4.5`, () => expect(contrast(set[fg], set[bg])).toBeGreaterThanOrEqual(4.5));
    for (const [fg, bg, what] of large) it(`${theme}: ${what} (${fg} on ${bg}) ≥ 3`, () => expect(contrast(set[fg], set[bg])).toBeGreaterThanOrEqual(3));
  }
  it('the system dark theme uses the same values as the explicit one', () => {
    expect(block(paletteGrid, ':root[data-palette="grid"]:not([data-theme]) {')).toEqual(block(paletteGrid, ':root[data-palette="grid"][data-theme="dark"] {'));
  });
  it('the action is not red; danger is not redefined', () => {
    const [r, gg, b] = block(paletteGrid, ':root[data-palette="grid"] {').accent;
    expect(b > r && b > gg).toBe(true);
    expect(block(paletteGrid, ':root[data-palette="grid"] {').danger).toBeUndefined();
  });
});
