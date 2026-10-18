// D89: the medicines register (data.gov.ua, МОЗ, CC BY 4.0) → a light index for autocomplete on the device, no sync:
// trade name, INN, the Ukrainian substance words, form, the package doses, ATC, prescription-only. Run once a quarter:
//   node scripts/build-meds-index.mjs path/to/reestr.csv
// Substances (raw material) and registrations stopped early are left out. See docs/registry.md.
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/build-meds-index.mjs reestr.csv'); process.exit(1); }
const text = new TextDecoder('windows-1251').decode(readFileSync(file));

/** RFC 4180 with «;» — quotes may hold «;» and line breaks. */
function parse(src) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const [head, ...data] = parse(text);
const ix = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
const g = (r, n) => (r[ix[n]] ?? '').trim();
// D97: «Вітамін D3», «Аторвастатин Крка», «Нурофєн® для дітей» — not «Вітамін d3» or «Аторвастатин крка»
const SMALL = new Set(['для', 'з', 'із', 'зі', 'та', 'і', 'й', 'у', 'в', 'на', 'по', 'від', 'до', 'дітей', 'дорослих', 'немовлят']);
const part = (w, first) => {
  if (/\d/.test(w) && /^[A-Z0-9.+/]+$/.test(w)) return w; // D3, B12, 5HTP
  if (/^[A-Z]{1,4}$/.test(w)) return w; // a short Latin abbreviation: XR, SR, MR
  const l = w.toLocaleLowerCase('uk');
  return !first && SMALL.has(l) ? l : l.charAt(0).toLocaleUpperCase('uk') + l.slice(1);
};
const cap = (s) => s.split(' ').map((w, i) => w.split(/([-–])/).map((x, j) => (x === '-' || x === '–' ? x : part(x, i === 0 && j === 0))).join('')).join(' ');
const DOSE = /по\s+(\d+(?:[.,]\d+)?\s*(?:мг|мкг|г|МО|ОД))(?![\p{L}])/giu; // D97: strengths only — not «100 мл» of an infusion

const byKey = new Map();
for (const r of data) {
  const form = g(r, 'Форма випуску');
  if (!form || /субстанц/i.test(form) || g(r, 'Дострокове припинення') === 'Так') continue;
  const name = cap(g(r, 'Торгівельне найменування'));
  const innRaw = g(r, 'Міжнародне непатентоване найменування');
  const inn = /^(comb drug|mono)$/i.test(innRaw) ? '' : innRaw;
  // the Ukrainian substance words: what the composition says is contained, before the first number
  const sub = (/містить[:\s]+([^0-9]+?)\s*\d/iu.exec(g(r, 'Склад (діючі)'))?.[1] ?? '').replace(/[,;(].*$/u, '').trim().toLocaleLowerCase('uk').slice(0, 60);
  const key = `${name}|${inn}`;
  const e = byKey.get(key) ?? { n: name, i: inn, s: sub, f: form.split(/[,;]| по /u)[0].trim().slice(0, 40), d: new Set(), a: g(r, 'Код АТС 1'), r: g(r, 'Умови відпуску') === 'за рецептом' ? 1 : 0 };
  for (const m of form.matchAll(DOSE)) e.d.add(m[1].replace(/\s+/g, ' '));
  if (!e.s && sub) e.s = sub;
  byKey.set(key, e);
}
const list = [...byKey.values()].sort((a, b) => a.n.localeCompare(b.n, 'uk'))
  .map((e) => [e.n, e.i, e.s, e.f, [...e.d].slice(0, 8).join(', '), e.a, e.r]);
const out = { source: 'Державний реєстр лікарських засобів України, МОЗ — data.gov.ua, CC BY 4.0', built: new Date().toISOString().slice(0, 10),
  fields: ['name', 'inn', 'substance', 'form', 'doses', 'atc', 'rx'], list };
writeFileSync('public/meds-index.json', JSON.stringify(out));
console.log(`${list.length} entries → public/meds-index.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
