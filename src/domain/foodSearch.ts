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

/** Foods (or dishes) whose name or aliases contain every query word (by stem); the closest first. */
export function searchFoods<T extends { id: string; name: string; aliases?: string[] }>(foods: T[], text: string, limit = 8,
  prefer: ReadonlySet<string> = new Set()): T[] {
  const tokens = normalize(text).split(' ').filter((t) => t.length >= 2).map(stem);
  if (tokens.length === 0) return [];
  const scored: [T, number][] = [];
  for (const food of foods) {
    const ws = words(food);
    if (!tokens.every((t) => ws.some((w) => w.startsWith(t)))) continue;
    const name = normalize(food.name);
    // the name starting with the word first; then what this person usually eats (D30); then the shorter name
    const score = (name.startsWith(tokens[0]!) ? 0 : 1) + (prefer.has(food.id) ? -0.5 : 0) + name.split(' ').length / 100;
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
    : q.measure ? unitOf(food, q.measure) ?? (q.measure === 'шт' ? first : undefined)
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
}

/** Each part of a phrase matched to a dish (when the words name one) or a food, with its amount. */
export function recognize(raw: string, foods: Food[], recipes: Recipe[], dishItem: (r: Recipe, portions: number) => MealItem,
  prefer: ReadonlySet<string> = new Set()): Recognized[] {
  return splitPhrase(raw).map((text) => {
    const q = parseQuery(text);
    if (!q.text) return { text };
    const dish = searchFoods(recipes, q.text, 1, prefer)[0];
    const food = searchFoods(foods, q.text, 1, prefer)[0];
    // a dish wins only when the words fit it as well as a food (so «салат» is the salad, «огірок» the cucumber)
    if (dish && (!food || normalize(dish.name).startsWith(stem(normalize(q.text).split(' ')[0]!)))) {
      return { text, item: dishItem(dish, q.qty ?? 1) };
    }
    return food ? { text, item: itemFor(food, q) } : { text };
  });
}
