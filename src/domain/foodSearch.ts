// Find a food by how people say it («2 варених яйця», «150 г гречки», «склянка кефіру») and turn the amount
// into grams through the food's household measures (D26). Pure.
import { normalize } from './nutrition';
import type { Food, FoodUnit, MealItem, Recipe } from './types';

/** Measure words in the query → the unit name stored in foods.ts ("г" = grams). */
const MEASURES: [RegExp, string][] = [
  [/^(г|гр|грам\p{L}*)$/u, 'г'],
  [/^(шт|штук\p{L}*|штуки)$/u, 'шт'],
  [/^(стл|ложк\p{L}*|ложок)$/u, 'ст. л.'],
  [/^(чл)$/u, 'ч. л.'],
  [/^(склян\p{L}*)$/u, 'склянка'],
  [/^(скиб\p{L}*)$/u, 'скибка'],
  [/^(шмат\p{L}*|кусок|куска|куски|кусків|кусочок|кусочки|кусочків)$/u, 'шматок'], // D77: «2 куски хліба»
  [/^(жмен\p{L}*)$/u, 'жменя'],
  [/^(порці\p{L}*|тарілк\p{L}*)$/u, 'порція'],
  [/^(чашк\p{L}*|кухл\p{L}*)$/u, 'склянка'],
  [/^(банк\p{L}*|банок)$/u, 'банка'],
];

// Spoken amounts (dictation writes numbers as words): «два», «півтори», «пару», «сто»…
const NUMBER_WORDS: Record<string, number> = {
  пів: 0.5, половина: 0.5, половину: 0.5, півтори: 1.5, півтора: 1.5,
  одне: 1, один: 1, одна: 1, одну: 1, два: 2, дві: 2, пару: 2, три: 3, чотири: 4, пять: 5, шість: 6, сім: 7, вісім: 8,
  девять: 9, десять: 10, сто: 100, двісті: 200, триста: 300, чотириста: 400, пятсот: 500,
};

export interface Query {
  text: string; // what is left to search by
  qty?: number;
  measure?: string; // "г", "шт", "ст. л."…
}

export function parseQuery(raw: string): Query {
  const words = normalize(raw).replace(/(^|\s)ст\.?\s*л\.?/gu, '$1стл ').replace(/(^|\s)ч\.?\s*л\.?/gu, '$1чл ')
    .replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)([^\d\s.])/gu, '$1 $2').split(' ').filter(Boolean);
  let qty: number | undefined;
  let measure: string | undefined;
  const rest: string[] = [];
  for (const w of words) {
    if (qty === undefined && /^\d+(\.\d+)?$/.test(w)) { qty = Number(w); continue; }
    if (qty === undefined && w in NUMBER_WORDS) { qty = NUMBER_WORDS[w]; continue; }
    const m = MEASURES.find(([re]) => re.test(w));
    if (m && measure === undefined) { measure = m[1]; if (qty === undefined) qty = 1; continue; }
    rest.push(w);
  }
  return { text: rest.join(' '), ...(qty !== undefined ? { qty } : {}), ...(measure ? { measure } : {}) };
}

/** A word's stem for loose Ukrainian matching: «яйця» ~ «яйце», «варених» ~ «варене», «гречки» ~ «гречка». */
function stem(word: string): string {
  const w = word.startsWith('відвар') ? word.slice(3) : word; // «відварне» = «варене»
  return w.slice(0, Math.max(3, Math.min(w.length - 3, 4)));
}

function words(food: { name: string; aliases?: string[] }): string[] {
  return [food.name, ...(food.aliases ?? [])].flatMap((s) => normalize(s).split(/[\s(),/%]+/)).filter(Boolean)
    .map((w) => (w.startsWith('відвар') ? w.slice(3) : w));
}

/** D77: the stems said right after «без» — «без цукру» is a property of a food, not a word to match. */
function withoutStems(text: string): Set<string> {
  const ws = normalize(text).split(/[\s(),/%]+/).filter(Boolean);
  return new Set(ws.flatMap((w, i) => (ws[i - 1] === 'без' ? [stem(w)] : [])));
}

const SEP = /[\s(),/%]+/; // D83: a name said as written, «(сухі)» and all, splits like the base's names

/** D83: how well the said words fit a name (or one of its aliases): 0 — each is a word of it, 1 — each starts a word of
 *  it, 2 — by stems only («курага» ~ «курячий»); then how many words the name has beyond what was said. Lower is closer.
 *  The exact name always comes before a name that merely shares the beginning. */
export function fit(food: { name: string; aliases?: string[] }, text: string): [number, number] {
  const said = normalize(text).split(SEP).filter((w) => w.length >= 2 || /\d/.test(w)); // «Кефір 1 %» — the 1 counts
  // «хліба» ~ «хліб», «гречки» ~ «гречка»: the word without its ending still starts the name's word
  const near = (s: string, w: string) => w.startsWith(s) || (s.length >= 4 && w.startsWith(s.slice(0, -1))) || (s.length >= 5 && w.startsWith(s.slice(0, -2)));
  let best: [number, number] = [3, 99];
  for (const v of [food.name, ...(food.aliases ?? [])]) {
    const ws = normalize(v).split(SEP).filter(Boolean).map((w) => (w.startsWith('відвар') ? w.slice(3) : w));
    const rank = said.every((s) => ws.includes(s)) ? 0 : said.every((s) => s.length >= 4 && ws.some((w) => near(s, w))) ? 1 : 2;
    const extra = Math.max(0, ws.length - said.length);
    if (rank < best[0] || (rank === best[0] && extra < best[1])) best = [rank, extra];
  }
  return best;
}

const USUAL: Record<string, string> = { хліб: 'bread-white', хліба: 'bread-white', хлібу: 'bread-white', рис: 'white-rice-boiled', риса: 'white-rice-boiled',
  гречка: 'buckwheat-boiled', гречки: 'buckwheat-boiled', гречку: 'buckwheat-boiled', сир: 'cottage-cheese', сиру: 'cottage-cheese' }; // what is on the plate

/** Foods (or dishes) whose name or aliases contain every query word (by stem); the closest first.
 *  «з цукром» never finds «без цукру», nor «без цукру» a food with sugar (D77). */
export function searchFoods<T extends { id: string; name: string; aliases?: string[] }>(foods: T[], text: string, limit = 8,
  prefer: ReadonlySet<string> = new Set()): T[] {
  const raw = normalize(text).split(SEP).filter((t) => t.length >= 2 || /\d/.test(t));
  const tokens = raw.map(stem);
  if (tokens.length === 0) return [];
  const qWithout = withoutStems(text);
  const said = tokens.filter((t) => t !== 'без' && !qWithout.has(t));
  const scored: [T, number][] = [];
  for (const food of foods) {
    const ws = words(food);
    if (!tokens.every((t) => ws.some((w) => w.startsWith(t)))) continue;
    const fWithout = withoutStems([food.name, ...(food.aliases ?? [])].join(' '));
    if ([...fWithout].some((s) => said.some((t) => s.startsWith(t) || t.startsWith(s)))) continue; // «з цукром» ≠ «без цукру»
    if ([...qWithout].some((s) => !fWithout.has(s) && ws.some((w) => w.startsWith(s)))) continue; // «без цукру» ≠ «з цукром»
    const name = normalize(food.name);
    // the name starting with the word first; then what this person usually eats (D30); then the shorter name
    // D45: the whole word said beats a longer one that shares its stem («кава» → Кава, not Кавун)
    const whole = ws.some((w) => w === raw[0] || (raw[0]!.length >= 4 && w.startsWith(raw[0]!))) ? -0.3 : 0;
    // D81: a word alone means the everyday kind («хліб» — wheat), over a name that merely starts with it; a habit (prefer) still wins
    const usual = raw.length === 1 && USUAL[raw[0]!] === food.id ? -1.2 : 0;
    const score = fit(food, text)[0] * 2 + (name.startsWith(tokens[0]!) ? 0 : 1) + whole + usual + (prefer.has(food.id) ? -0.5 : 0) + name.split(' ').length / 100;
    scored.push([food, score]);
  }
  return scored.sort((a, b) => a[1] - b[1]).slice(0, limit).map(([f]) => f);
}

export function unitOf(food: Food | undefined, name: string | undefined): FoodUnit | undefined {
  if (!food?.units || !name) return undefined;
  return food.units.find((u) => u.name === name) ?? food.units.find((u) => u.name.startsWith(name));
}

/** The meal line for a food and a parsed amount. Without a measure, a small number means the food's first
 *  household measure («2 яйця» = 2 шт), a big one means grams («150 гречки»); nothing given = one measure or 100 g. */
export function itemFor(food: Food, q: Pick<Query, 'qty' | 'measure'>): MealItem {
  const first = food.units?.[0];
  const unit = q.measure === 'г' ? undefined
    : q.measure ? unitOf(food, q.measure) ?? (q.measure === 'шматок' ? unitOf(food, 'скибка') : undefined)
      ?? (q.measure === 'шт' || q.measure === 'шматок' ? first : undefined)
      : q.qty === undefined || q.qty < 20 ? first : undefined;
  if (unit) {
    const qty = q.qty ?? 1;
    return { foodId: food.id, name: food.name, grams: Math.round(qty * unit.grams), unit: { name: unit.name, qty, grams: unit.grams } };
  }
  return { foodId: food.id, name: food.name, grams: Math.round(q.measure === 'г' || (q.qty ?? 0) >= 20 ? q.qty ?? 100 : 100) };
}

/** Ukrainian forms of the measure words: 1 скибка, 2 скибки, 5 скибок; a fraction takes «скибки». */
const FORMS: Record<string, [string, string, string]> = {
  скибка: ['скибка', 'скибки', 'скибок'], склянка: ['склянка', 'склянки', 'склянок'], порція: ['порція', 'порції', 'порцій'],
  жменя: ['жменя', 'жмені', 'жмень'], банка: ['банка', 'банки', 'банок'], баночка: ['баночка', 'баночки', 'баночок'],
  шматок: ['шматок', 'шматки', 'шматків'], пачка: ['пачка', 'пачки', 'пачок'], половинка: ['половинка', 'половинки', 'половинок'],
};

export function measureWord(name: string, qty: number): string {
  const f = FORMS[name];
  if (!f) return name; // «шт», «ст. л.» do not change
  if (!Number.isInteger(qty)) return f[1];
  const n10 = qty % 10, n100 = qty % 100;
  return n10 === 1 && n100 !== 11 ? f[0] : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? f[1] : f[2];
}

/** D79: «≈» grams as people think of them — «тарілка ≈ 450 г», not «≈ 466 г». Display only; the line keeps its grams. */
export function approxG(g: number): number {
  const step = g < 100 ? 5 : g < 300 ? 10 : 50;
  return Math.max(step, Math.round(g / step) * step);
}

/** «2 шт» / «2 скибки» / «150 г» — how an item's amount reads. */
export function amountText(item: MealItem): string {
  if (item.recipe) return `${String(item.recipe.portions).replace('.', ',')} ${measureWord('порція', item.recipe.portions)}`;
  if (!item.unit) return `${item.grams} г`;
  const q = Number.isInteger(item.unit.qty) ? String(item.unit.qty) : String(item.unit.qty).replace('.', ',');
  return `${q} ${measureWord(item.unit.name, item.unit.qty)}`;
}

export type { Recipe };

// ------------------------------------------------------------------ a whole phrase (D30: dictation)
/** «два варених яйця, склянку кефіру і салат» → its parts. */
export function splitPhrase(raw: string): string[] {
  return raw.split(/[,;.]|\s+(?:і|й|та|ще|плюс|а також)\s+/iu).map((s) => s.trim()).filter(Boolean);
}

export interface Recognized {
  text: string;
  item?: MealItem; // undefined = nothing found for this part
  others?: MealItem[]; // D81: other foods the same words fit («хліб» → житній, цільнозерновий) — one tap to choose
  estimate?: boolean; // D32: not in the base — nutrients are the photo's estimate
  unsure?: boolean; // D32: the photo was hard to read
}

/** Each part of a phrase matched to a dish (when the words name one) or a food, with its amount. */
export function recognize(raw: string, foods: Food[], recipes: Recipe[], dishItem: (r: Recipe, portions: number) => MealItem,
  prefer: ReadonlySet<string> = new Set()): Recognized[] {
  return splitPhrase(raw).map((text) => {
    const q = parseQuery(text);
    if (!q.text) return { text };
    const dish = searchFoods(recipes, q.text, 1, prefer)[0];
    const food = searchFoods(foods, q.text, 1, prefer)[0];
    // D83: the closer fit wins — «курага» is the dried apricot, not «Курячий суп»; «гречка» the buckwheat, not «Гречка з
    // куркою»; on an equal fit the dish (so «салат» is the salad, «огірок» the cucumber)
    const df = dish && fit(dish, q.text), ff = food && fit(food, q.text);
    if (dish && (!food || df![0] < ff![0] || (df![0] === ff![0] && df![1] <= ff![1] && normalize(dish.name).startsWith(stem(normalize(q.text).split(' ')[0]!))))) {
      return { text, item: dishItem(dish, q.qty ?? 1) };
    }
    if (!food) return { text };
    // a word alone may mean several kinds
    const others = q.text.split(' ').length > 1 ? [] : searchFoods(foods, q.text, 6, prefer)
      .filter((f, i, all) => f.id !== food.id && f.name !== food.name && fit(f, q.text)[0] < 2 && all.findIndex((x) => x.name === f.name) === i) // D83: no twins
      .slice(0, 3).map((f) => itemFor(f, q));
    return { text, item: itemFor(food, q), ...(others.length ? { others } : {}) };
  });
}
