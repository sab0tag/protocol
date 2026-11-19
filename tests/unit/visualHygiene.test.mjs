// D190 («Очередь агента», задача 12): order that survives any style — colours only through tokens, captions ≥ 13 px and body 16 px
// at 1.45, spacing on a 4 px grid, nothing pressable under 44 px. The direction's colours themselves (C or «01») stay a token file.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sources = walk(join(root, 'src')).filter((p) => p.endsWith('.tsx'));
const css = walk(join(root, 'src/styles')).filter((p) => p.endsWith('.css'));
const read = (p) => readFileSync(p, 'utf8');
const hits = (files, re) => files.flatMap((p) => read(p).split('\n').flatMap((line, i) => (re.test(line) ? [`${p.slice(root.length + 1)}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])));

describe('colours only through tokens', () => {
  it('no hex colours and no rgb() without a token in components', () => {
    expect(hits(sources, /(?<![&\w])#[0-9a-fA-F]{3,8}\b(?![\w-])|rgba?\((?!var\()/)).toEqual([]);
  });
  it('no Tailwind palette colours (bg-red-500, text-white…) — tokens only', () => {
    expect(hits(sources, /\b(bg|text|border|fill|stroke|ring|from|to|via|outline|decoration)-(red|green|blue|gray|slate|zinc|neutral|stone|amber|yellow|orange|emerald|teal|sky|indigo|violet|purple|pink|rose|lime|cyan|fuchsia|white|black)(-\d{2,3})?\b/)).toEqual([]);
  });
});

describe('type and rhythm', () => {
  it('captions ≥ 13 px: the xs step is 13 px, no smaller font size in CSS or as an arbitrary class', async () => {
    const config = (await import(join(root, 'tailwind.config.js'))).default;
    expect(config.theme.extend.fontSize.xs[0]).toBe('0.8125rem');
    const small = css.flatMap((p) => [...read(p).matchAll(/font-size:\s*([0-9.]+)(rem|px)/g)]
      .filter((m) => (m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1])) < 13).map((m) => `${p}: ${m[0]}`));
    expect(small).toEqual([]);
    expect(hits(sources, /text-\[(?:[0-9]|1[0-2])px\]|text-\[0?\.[0-7]\d*rem\]/)).toEqual([]);
  });
  it('body text 16 px with line height 1.45', () => {
    expect(read(join(root, 'src/styles/index.css'))).toMatch(/body \{[^}]*font-size: 1rem; line-height: 1\.45;/);
  });
  it('spacing on a 4 px grid — no half steps', () => {
    expect(hits([...sources, ...css], /(?<![\w-])-?(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-y|space-x|top|left|right|bottom|inset)-\d+\.5(?![\w.])/)).toEqual([]);
    const off = css.flatMap((p) => [...read(p).matchAll(/(?:gap|padding|margin)[a-z-]*:\s*([^;]+)/g)]
      .flatMap((m) => [...m[1].matchAll(/([0-9]*\.?[0-9]+)rem/g)].filter((x) => (Number(x[1]) * 16) % 4 !== 0).map(() => `${p}: ${m[0]}`)));
    expect(off).toEqual([]);
  });
});

describe('touch targets', () => {
  it('nothing pressable under 44 px — no 32/36 px heights, no 32/36 px icon buttons', () => {
    expect(hits(sources, /min-h-\[(?:1|1\.5|2|2\.25|2\.5)rem\]|\bh-(?:6|7|8|9|10) w-(?:6|7|8|9|10)\b.*(?:onClick|type="(?:button|submit)")|(?:onClick|type="(?:button|submit)").*\bh-(?:6|7|8|9|10) w-(?:6|7|8|9|10)\b/)).toEqual([]);
  });
});
