// D89: the medicines register on the device — a name to pick, never a dose. Search by trade name, INN (Latin) and the
// Ukrainian substance, forgiving a typo and Latin typing («nurofen»); two medicines of the plan with one INN get a note
// to check with the doctor — information, never «не приймайте». Pure; the index comes from scripts/build-meds-index.mjs.
import type { Prescription } from './types';

export interface MedEntry { name: string; inn: string; substance: string; form: string; doses: string; atc: string; rx: boolean }
export interface MedIndex { source: string; built: string; list: MedEntry[] }

export function readIndex(raw: { source: string; built: string; list: [string, string, string, string, string, string, number][] }): MedIndex {
  return { source: raw.source, built: raw.built, list: raw.list.map(([name, inn, substance, form, doses, atc, rx]) => ({ name, inn, substance, form, doses, atc, rx: rx === 1 })) };
}

/** Letters that people mix up (Ukrainian, Russian layout) folded to one: «ибупрофен» ~ «ібупрофен», «нурофен» ~ «нурофєн». */
export function fold(s: string): string {
  return s.toLocaleLowerCase('uk').replace(/[®™’'ʼ`]/g, '').replace(/[іїиы]/g, 'и').replace(/[єэё]/g, 'е').replace(/ґ/g, 'г').replace(/й/g, 'и')
    .replace(/[ьъ]/g, '').replace(/[–—-]/g, ' ').replace(/\s+/g, ' ').trim();
}

const LAT: [RegExp, string][] = [[/shch/g, 'щ'], [/sch/g, 'щ'], [/zh/g, 'ж'], [/kh/g, 'х'], [/ch/g, 'ч'], [/sh/g, 'ш'], [/ts/g, 'ц'], [/ya/g, 'я'], [/yu/g, 'ю'],
  [/ph/g, 'ф'], [/x/g, 'кс'], [/a/g, 'а'], [/b/g, 'б'], [/c/g, 'к'], [/d/g, 'д'], [/e/g, 'е'], [/f/g, 'ф'], [/g/g, 'г'], [/h/g, 'г'], [/i/g, 'и'], [/j/g, 'и'],
  [/k/g, 'к'], [/l/g, 'л'], [/m/g, 'м'], [/n/g, 'н'], [/o/g, 'о'], [/p/g, 'п'], [/q/g, 'к'], [/r/g, 'р'], [/s/g, 'с'], [/t/g, 'т'], [/u/g, 'у'], [/v/g, 'в'],
  [/w/g, 'в'], [/y/g, 'и'], [/z/g, 'з']];
/** «nurofen» → «нурофен»: Latin typing of a Cyrillic name. */
export const toCyr = (s: string) => LAT.reduce((x, [re, c]) => x.replace(re, c), s.toLowerCase());

/** One edit apart (a letter missed, added or wrong) — «нурафен», «ибупрофн». */
function near(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

const words = (s: string) => fold(s).split(/[\s,()/+&.]+/).filter(Boolean);

/** Up to `limit` entries, the closest first: a name that starts with the words, then a word of the name, the INN, the substance. */
export function searchMeds(index: MedIndex, query: string, limit = 8): MedEntry[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const variants = [words(q), ...(/[a-z]/i.test(q) ? [words(toCyr(q))] : [])];
  const scored: [MedEntry, number][] = [];
  for (const e of index.list) {
    const name = words(e.name), inn = words(e.inn), sub = words(e.substance);
    let best = Infinity;
    for (const qs of variants) {
      let score = 0;
      for (const [k, w] of qs.entries()) {
        const pre = (ws: string[]) => ws.some((x) => x.startsWith(w));
        const typo = (ws: string[]) => w.length >= 5 && ws.some((x) => near(x.slice(0, w.length), w) || near(x, w));
        const s = k === 0 && name[0]?.startsWith(w) ? 0 : pre(name) ? 1 : pre(inn) ? 2 : pre(sub) ? 3
          : typo(name) ? 4 : typo(inn) ? 5 : typo(sub) ? 6 : Infinity;
        score = Math.max(score, s);
        if (score === Infinity) break;
      }
      best = Math.min(best, score);
    }
    // D97: what a patient takes at home first — infusions, injections, ampoules go down the list
    const hospital = /інфуз|ін[’']?єкц|ампул|концентрат для|для розчину для|парентеральн/iu.test(e.form) ? 0.5 : 0;
    if (best < Infinity) scored.push([e, best + hospital + e.name.length / 1000]);
  }
  return scored.sort((a, b) => a[1] - b[1]).slice(0, limit).map(([e]) => e);
}

export interface Duplicate { inn: string; titles: string[] }

/** Medicines of the plan with the same INN — «Нурофєн і Ібупрофен — одна речовина». Combined drugs (no single INN) are
 *  not compared: their substances differ by package and a wrong «the same» would be worse than none. */
export function duplicateInn(prescriptions: Prescription[]): Duplicate[] {
  const by = new Map<string, string[]>();
  for (const p of prescriptions) {
    const inn = p.med?.inn?.trim();
    if (!inn || (p.kind !== 'medication' && p.kind !== 'supplement')) continue;
    const k = inn.toLowerCase();
    by.set(k, [...(by.get(k) ?? []), p.title]);
  }
  return [...by.entries()].filter(([, t]) => t.length > 1).map(([inn, titles]) => ({ inn: prescriptions.find((p) => p.med?.inn?.toLowerCase() === inn)!.med!.inn!, titles }));
}
