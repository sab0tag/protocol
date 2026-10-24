// «Мої страви» — a list at once (SPEC.md D123). Pure: a pasted list or a file → lines, each sorted into one of four ways, and
// only one of them costs a request to the model. (1) «вже є» — the name is an own dish, a built-in one or a Харчоблок card;
// (2) every ingredient named with its amount and found in the base — the breakdown is made here; (3) a make-up with something
// not found or not counted — to the model, as D110; (4) only a name — a draft «Потрібен склад», no numbers (ТЗ v1.0, R08).
// The export is the same format back: .json keeps every number (the round trip asks nothing of the model), .csv is to read.
import type { DishLine } from './dishBreakdown';
import { readMeal } from './foodSearch';
import type { Food, MealItem, Recipe } from './types';

export const MAX_ROWS = 100, MAX_BYTES = 100_000, MAX_LINE = 400, PACK = 15;

export interface ListRow { key: string; name: string; text: string; make?: string; portions?: number; cut?: true }
export type Way =
  | { kind: 'exists'; where: 'own' | 'builtin' | 'harch' | 'base'; local?: Local }
  | { kind: 'local'; lines: DishLine[]; portions: number }
  | { kind: 'ai' }
  | { kind: 'draft' }
  | { kind: 'notDish' };
export interface Local { lines: DishLine[]; portions: number }
export interface ListContext { foods: Food[]; recipes: Recipe[]; harch: string[]; dishItem: (r: Recipe, portions: number) => MealItem }

const nameKey = (s: string) => s.toLocaleLowerCase('uk').replace(/[’'`]/g, '’').replace(/\s+/g, ' ').trim();
const cap = (s: string) => s.charAt(0).toLocaleUpperCase('uk') + s.slice(1);

/** A line: «Назва — склад», «Назва - склад», «Назва: склад» or a name alone; numbering and bullets go. */
function rowOf(raw: string, key: string): ListRow | null {
  let line = raw.replace(/^\s*(?:\d{1,3}[.)]|[-•*–·])\s+/u, '').trim();
  if (!line) return null;
  const cut = line.length > MAX_LINE;
  if (cut) line = line.slice(0, MAX_LINE);
  const m = /^(.+?)\s*(?:—|–|\s-\s|:)\s*(.*)$/u.exec(line);
  const name = (m ? m[1]! : line).trim(), make = m?.[2]?.trim();
  return name ? { key, name: cap(name), text: line, ...(make ? { make } : {}), ...(cut ? { cut: true } : {}) } : null;
}

/** Repeats of a name (case and spaces aside) become one line — before anything else. */
function merged(rows: ListRow[]): { rows: ListRow[]; merged: number } {
  const seen = new Set<string>(), out: ListRow[] = [];
  for (const r of rows) { const k = nameKey(r.name); if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return { rows: out, merged: rows.length - out.length };
}

export interface Parsed { rows: ListRow[]; merged: number; over: number; cut: number }

/** Pasted text, or a .txt file: one dish a line. */
export function parseText(text: string): Parsed {
  const all = text.split(/\r?\n/).map((l, i) => rowOf(l, `r${i}`)).filter((r): r is ListRow => !!r);
  const m = merged(all);
  return { rows: m.rows.slice(0, MAX_ROWS), merged: m.merged, over: Math.max(0, m.rows.length - MAX_ROWS), cut: m.rows.filter((r) => r.cut).length };
}

/** One CSV record per line; a field in quotes may hold the delimiter and "" for a quote. */
function csvLines(text: string, d: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i += 1; } else if (c === '"') q = false; else f += c; continue; }
    if (c === '"') q = true;
    else if (c === d) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); out.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); out.push(row); }
  return out;
}

/** .csv «назва;склад;порцій» — the delimiter («;» or «,») from the first line; a header line is skipped. */
export function parseCsv(text: string): Parsed {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const d = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const recs = csvLines(text, d).filter((r) => r.some((x) => x.trim()));
  if (recs[0] && /^\s*(назва|name)\s*$/i.test(recs[0][0] ?? '')) recs.shift();
  const all = recs.flatMap((r, i) => {
    const [name = '', make = '', portions = ''] = r.map((x) => x.trim());
    const row = rowOf(make ? `${name} — ${make}` : name, `r${i}`);
    const p = Number(portions.replace(',', '.'));
    return row ? [{ ...row, ...(p >= 1 && p <= 50 ? { portions: Math.round(p) } : {}) }] : [];
  });
  const m = merged(all);
  return { rows: m.rows.slice(0, MAX_ROWS), merged: m.merged, over: Math.max(0, m.rows.length - MAX_ROWS), cut: m.rows.filter((r) => r.cut).length };
}

/** A file's text: UTF-8, else Windows-1251 (a file saved by Excel on Windows); null — neither reads as words. */
export function decode(bytes: Uint8Array): string | null {
  const words = (s: string) => s.length > 0 && (s.match(/[\p{L}\p{N}\p{P}\p{S}\p{Zs}\t\r\n]/gu) ?? []).length / s.length > 0.95;
  try { const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); return words(s) ? s : null; } catch { /* not UTF-8 */ }
  try { const s = new TextDecoder('windows-1251').decode(bytes); return words(s) ? s : null; } catch { return null; }
}

// a to-do, not a dish: «купити хліб», «подзвонити мамі»
const TODO = /^(купити|замовити|подзвонити|зателефонувати|забрати|не\s+забути|перевірити|записати|оплатити|взяти|відправити|написати)(?!\p{L})/iu;
// what a make-up may say besides ingredients: the portions and how it is cooked
const PORTIONS = /(?:^|[,;]\s*)(?:на\s+)?(\d{1,2})\s*порці\p{L}*\s*(?=[,;]|$)/iu;
const COOKING = /^(?:на|в|у)\s+(?:пательні|сковороді|сковорідці|духовці|грилі|парі|мультиварці|аерогрилі|олії)$|^(?:смаж\p{L}*|запеч\p{L}*|відвар\p{L}*|тушк\p{L}*|варен\p{L}*|печен\p{L}*)$/iu;
// (JavaScript's \b does not see Cyrillic words — the borders are letters or not)
const AMOUNT = /\d|(?<!\p{L})(?:пів|половин\p{L}*|один|одна|одне|два|дві|три|чотири|п[’']ять|шість|сім|вісім|дев[’']ять|десять)(?!\p{L})/iu;

/** A make-up read here: every part an ingredient of the base, found as the first choice, with an amount said. */
export function readLocal(make: string, ctx: ListContext): Local | null {
  let text = make;
  const p = PORTIONS.exec(text);
  if (p) text = text.replace(PORTIONS, '');
  const rows = readMeal(text, ctx).rows;
  const lines: DishLine[] = [];
  for (const [i, r] of rows.entries()) {
    if (COOKING.test(r.text.trim())) continue;
    if (!r.item?.foodId || r.item.recipe || !AMOUNT.test(r.text)) return null;
    const food = ctx.foods.find((f) => f.id === r.item!.foodId);
    if (!food) return null;
    lines.push({ key: `i${i}`, said: food.name, food, grams: Math.round(r.item.grams * 10) / 10, amountSaid: true });
  }
  return lines.length ? { lines, portions: p ? Math.max(1, Number(p[1])) : 1 } : null;
}

/** Which of the four ways a line goes. */
export function wayOf(row: ListRow, ctx: ListContext): Way {
  if (TODO.test(row.name)) return { kind: 'notDish' };
  const k = nameKey(row.name);
  const local = row.make ? readLocal(row.make, ctx) : null;
  const withPortions = (l: Local | null) => (l && row.portions ? { ...l, portions: row.portions } : l);
  const own = ctx.recipes.find((r) => [r.name, ...(r.aliases ?? [])].some((n) => nameKey(n) === k));
  if (own) return { kind: 'exists', where: own.builtIn ? 'builtin' : 'own', ...(local ? { local: withPortions(local)! } : {}) };
  if (ctx.harch.some((n) => nameKey(n) === k)) return { kind: 'exists', where: 'harch', ...(local ? { local: withPortions(local)! } : {}) };
  // a food of the base by the same name («Голубці» is there as a ready dish) — found in «Записати їжу» already
  const food = ctx.foods.find((f) => [f.name, ...(f.aliases ?? [])].some((n) => nameKey(n) === k));
  if (food) return { kind: 'exists', where: food.custom ? 'own' : 'base', ...(local ? { local: withPortions(local)! } : {}) };
  if (local) return { kind: 'local', ...withPortions(local)! };
  return row.make ? { kind: 'ai' } : { kind: 'draft' };
}

/** «12 страв: 3 вже є, 2 без ІІ, 1 без складу, 6 підуть до ІІ (1 запит)» — counted from the same ways that are then sent. */
export function tally(ways: Way[]) {
  const ai = ways.filter((w) => w.kind === 'ai').length;
  return { all: ways.length, exists: ways.filter((w) => w.kind === 'exists').length, local: ways.filter((w) => w.kind === 'local').length,
    drafts: ways.filter((w) => w.kind === 'draft').length, ai, notDish: ways.filter((w) => w.kind === 'notDish').length, requests: Math.ceil(ai / PACK) };
}

/** Packs of up to 15 for the model, in the list's order. */
export const packs = <T>(xs: T[], size = PACK): T[][] => Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

// ------------------------------------------------------------------------------------------------ export
export interface DishFile { format: 'protocol-dishes'; v: 1; dishes: { name: string; items: MealItem[]; needsMake?: true }[] }

/** An own food is not on another phone: its line goes as a free line with its numbers for the grams (as when it is deleted). */
function portable(it: MealItem, foods: Map<string, Food>): MealItem {
  if (it.components?.length) return { ...it, components: it.components.map((c) => portable(c, foods)) };
  const f = it.foodId ? foods.get(it.foodId) : undefined;
  if (!f?.custom) return it;
  const k = it.grams / 100, p = f.per100g;
  const { foodId: _f, ...rest } = it;
  return { ...rest, manual: { kcal: p.kcal * k, protein: p.protein * k, fat: p.fat * k, carbs: p.carbs * k, ...(p.calciumMg != null ? { calciumMg: p.calciumMg * k } : {}) } };
}

export function toFile(recipes: Recipe[], foods: Map<string, Food>): DishFile {
  return { format: 'protocol-dishes', v: 1, dishes: recipes.filter((r) => !r.builtIn).map((r) => ({ name: r.name, items: r.items.map((it) => portable(it, foods)),
    ...(r.needsMake ? { needsMake: true as const } : {}) })) };
}

/** A file of our own export: every dish as it was — no model, the same numbers. */
export function fromFile(text: string, foods: Map<string, Food>): DishFile['dishes'] | null {
  try {
    const f = JSON.parse(text) as DishFile;
    if (f.format !== 'protocol-dishes' || f.v !== 1 || !Array.isArray(f.dishes)) return null;
    const ok = (it: MealItem): boolean => typeof it.name === 'string' && it.grams > 0 && (!it.foodId || foods.has(it.foodId) || !!it.manual)
      && (!it.components || it.components.every(ok));
    return f.dishes.filter((d) => typeof d.name === 'string' && d.name.trim() && Array.isArray(d.items) && (d.items.length ? d.items.every(ok) : d.needsMake === true))
      .slice(0, MAX_ROWS);
  } catch { return null; }
}

const grams = (g: number) => String(Math.round(g * 10) / 10).replace('.', ',');
/** .csv to read (and to load again: base ingredients come back without the model). */
export function toCsv(recipes: Recipe[]): string {
  const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ['назва;склад;порцій', ...recipes.filter((r) => !r.builtIn).map((r) =>
    [q(r.name), q(r.items.map((it) => `${it.name} ${grams(it.grams)} г`).join(', ')), '1'].join(';'))].join('\r\n') + '\r\n';
}

