// Find a food by how people say it («2 варених яйця», «150 г гречки», «склянка кефіру») and turn the amount
// into grams through the food's household measures (D26). Pure.
import { normalize } from './nutrition';
import type { Food, FoodUnit, MealItem, Recipe } from './types';

/** Measure words in the query → the unit name stored in foods.ts ("г" = grams). */
const MEASURES: [RegExp, string][] = [
  [/^(г|гр|грам\p{L}*)$/u, 'г'],
  [/^(мл|мілілітр\p{L}*)$/u, 'г'], // D123: a liquid by the millilitre ≈ grams; «250 мл кефіру» was read as «Млинці 250»
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

/** D97: words around the food that are not food — «з'їв борщ», «випила каву», «на обід гречка», «я ще поїв». */
const NOT_FOOD = new Set(['я', 'ще', 'зїв', 'зїла', 'зїли', 'їв', 'їла', 'їли', 'поїв', 'поїла', 'поїли', 'випив', 'випила', 'випили', 'пив', 'пила', 'пили',
  'скуштував', 'скуштувала', 'перекусив', 'перекусила', 'снідав', 'снідала', 'обідав', 'обідала', 'вечеряв', 'вечеряла']);
const MEAL_WORD = /^(сніданок|обід|вечерю|вечеря|перекус|полуденок)$/u;

export function parseQuery(raw: string): Query {
  const words = normalize(raw).replace(/(^|\s)ст\.?\s*л\.?/gu, '$1стл ').replace(/(^|\s)ч\.?\s*л\.?/gu, '$1чл ')
    .replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)([^\d\s.])/gu, '$1 $2').split(' ').filter(Boolean);
  let qty: number | undefined;
  let measure: string | undefined;
  const rest: string[] = [];
  for (const [i, w] of words.entries()) {
    if (NOT_FOOD.has(w) || ((w === 'на' || w === 'в' || w === 'у') && MEAL_WORD.test(words[i + 1] ?? '')) || (MEAL_WORD.test(w) && /^(на|в|у)$/u.test(words[i - 1] ?? ''))) continue;
    // D84: «кефір 1 %», «молоко 2,5%» — a number before «%» is part of the name, not how many
    if (/^\d+(\.\d+)?$/.test(w) && words[i + 1] === '%') { rest.push(w.replace('.', ',')); continue; }
    if (w === '%') { rest.push(w); continue; }
    // D106: «чай з 2 ложками цукру» — the number after «з», «без» is the sugar's, not the tea's: neither it nor its measure
    // is the amount of what is eaten (the words stay for the search)
    if (/^(з|із|зі|без)$/u.test(words[i - 1] ?? '') && (/^\d+(\.\d+)?$/.test(w) || w in NUMBER_WORDS)) {
      if (MEASURES.some(([re]) => re.test(words[i + 1] ?? ''))) words.splice(i + 1, 1);
      continue;
    }
    if (qty === undefined && /^\d+(\.\d+)?$/.test(w)) { qty = Number(w); continue; }
    if (qty === undefined && w in NUMBER_WORDS) { qty = NUMBER_WORDS[w]; continue; }
    const m = MEASURES.find(([re]) => re.test(w.replace(/\.$/, ''))); // «1 шт.»
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

/** Case and number endings of Ukrainian nouns and adjectives — «сиру», «гречки», «кефіром», «варених» (D85). */
const ENDINGS = ['ами', 'ями', 'ому', 'ого', 'ими', 'ім', 'ом', 'ем', 'єм', 'ою', 'ею', 'єю', 'ам', 'ям', 'ах', 'ях', 'ів', 'їв', 'ей',
  'ий', 'ій', 'ої', 'им', 'их', 'ої', 'а', 'я', 'у', 'ю', 'і', 'и', 'ї', 'е', 'є', 'о', 'ь'];
const lemma = (w: string) => { for (const e of ENDINGS) if (w.length - e.length >= 3 && w.endsWith(e)) return w.slice(0, -e.length); return w; };
/** The same word in another case: «сиру» ~ «сир», «гречки» ~ «гречка», «яйця» ~ «яйце» — but «сиру» is not «сирна». */
export const sameWord = (a: string, b: string) => a === b || (lemma(a) === lemma(b) && Math.min(a.length, b.length) >= 3);

const SEP = /[\s(),/%]+/; // D83: a name said as written, «(сухі)» and all, splits like the base's names

/** D83: how well the said words fit a name (or one of its aliases): 0 — each is a word of it, 1 — each starts a word of
 *  it, 2 — by stems only («курага» ~ «курячий»); then how many words the name has beyond what was said. Lower is closer.
 *  The exact name always comes before a name that merely shares the beginning. */
export function fit(food: { name: string; aliases?: string[] }, text: string): [number, number] {
  const said = normalize(text).split(SEP).filter((w) => w.length >= 2 || /\d/.test(w)); // «Кефір 1 %» — the 1 counts
  let best: [number, number] = [4, 99];
  for (const v of [food.name, ...(food.aliases ?? [])]) {
    const ws = normalize(v).split(SEP).filter(Boolean).map((w) => (w.startsWith('відвар') ? w.slice(3) : w));
    // T1 (D85): the whole word, then the same word in another case («сиру» ~ «сир», not «сирна»), then a beginning
    // («вівсян…»), then only a stem («курага» ~ «курячий»); the name's rank is its worst said word
    const one = (sw: string) => (ws.includes(sw) ? 0 : ws.some((w) => sameWord(sw, w)) ? 1
      : sw.length >= 4 && ws.some((w) => w.startsWith(sw)) ? 2 : 3);
    const rank = said.length ? Math.max(...said.map(one)) : 3;
    const extra = Math.max(0, ws.length - said.length);
    if (rank < best[0] || (rank === best[0] && extra < best[1])) best = [rank, extra];
  }
  return best;
}

const USUAL: Record<string, string> = { хліб: 'bread-white', хліба: 'bread-white', хлібу: 'bread-white', рис: 'white-rice-boiled', риса: 'white-rice-boiled',
  гречка: 'buckwheat-boiled', гречки: 'buckwheat-boiled', гречку: 'buckwheat-boiled', сир: 'cottage-cheese', сиру: 'cottage-cheese',
  яйце: 'egg-boiled', яйця: 'egg-boiled', яєць: 'egg-boiled',
  вівсянка: 'oatmeal-water', вівсянки: 'oatmeal-water', вівсянку: 'oatmeal-water' }; // what is on the plate (D105: the porridge, whatever the base's order)

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

/** T2 (D85): a unit said that the food has no measure for — counted by the usual kitchen table, never replaced by a
 *  portion. Liquids by volume (a glass of kefir ≈ 250 г), the rest by a typical fill. Shown with «≈» like any measure. */
const LIQUID = ['drink', 'dairy', 'soup', 'alcohol'];
function kitchen(food: Food, measure: string): number | undefined {
  const liquid = food.tags.some((x) => LIQUID.includes(x)) && !food.tags.includes('cheese');
  const table: Record<string, [number, number]> = { // [liquid, solid] grams
    'ст. л.': [15, 20], 'ч. л.': [5, 7], склянка: [250, 200], порція: [250, 200], жменя: [30, 30], банка: [250, 250], скибка: [30, 30], шматок: [30, 30],
  };
  const g = table[measure];
  return g ? g[liquid ? 0 : 1] : undefined;
}

/** The meal line for a food and a parsed amount. Without a measure, a small number means pieces or portions
 *  («2 яйця» = 2 шт), a big one means grams («150 гречки»); nothing given = one portion («гречка» is a side dish, not a
 *  spoon — D84), else the food's first measure, else 100 g. A spoon only when a spoon is said. */
export function itemFor(food: Food, q: Pick<Query, 'qty' | 'measure'>): MealItem {
  const first = food.units?.[0];
  const plain = q.qty === undefined ? unitOf(food, 'порція') ?? first : unitOf(food, 'шт') ?? unitOf(food, 'порція') ?? first;
  const unit = q.measure === 'г' ? undefined
    : q.measure ? unitOf(food, q.measure) ?? (q.measure === 'шматок' ? unitOf(food, 'скибка') : undefined)
      ?? (q.measure === 'шт' || q.measure === 'шматок' ? first : undefined)
      : q.qty === undefined || q.qty < 20 ? plain : undefined;
  const said = !unit && q.measure && q.measure !== 'г' && q.measure !== 'шт' ? kitchen(food, q.measure) : undefined;
  const use = unit ?? (said ? { name: q.measure!, grams: said } : undefined);
  if (use) {
    const qty = q.qty ?? 1;
    return { foodId: food.id, name: food.name, grams: Math.round(qty * use.grams), unit: { name: use.name, qty, grams: use.grams } };
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
  if (g % 5 === 0) return g; // D88: a whole count of a measure (1,5 × 250 = 375) stays as it is, only sums are rounded
  const step = g < 100 ? 5 : 10;
  return Math.max(step, Math.round(g / step) * step);
}

/** «2 шт» / «2 скибки» / «150 г» — how an item's amount reads. */
/** Whether «≈ N г» goes after the amount — not when the amount already is grams (D106: a dish said in grams). */
export const needsGrams = (item: MealItem): boolean => !!item.unit || (!!item.recipe && !item.recipe.byGrams);

export function amountText(item: MealItem): string {
  if (item.recipe?.byGrams) return `${item.grams} г`;
  if (item.recipe) return `${String(item.recipe.portions).replace('.', ',')} ${measureWord('порція', item.recipe.portions)}`;
  if (!item.unit) return `${item.grams} г`;
  const q = Number.isInteger(item.unit.qty) ? String(item.unit.qty) : String(item.unit.qty).replace('.', ',');
  return `${q} ${measureWord(item.unit.name, item.unit.qty)}`;
}

export type { Recipe };

// ------------------------------------------------------------------ a whole phrase (D30: dictation)
/** «два варених яйця, склянку кефіру і салат» → its parts. */
const ABBR = new Set(['ст', 'ч', 'л', 'г', 'гр', 'шт', 'конс', 'тощо', 'уп', 'пак', 'мл', 'кг']);

/** D105: what ends a dictation — said at the very end («…кава з молоком, це все»), it stops the microphone and is not food.
 *  Only at the end: «це все з'їв?» in the middle is left alone. */
const STOP = /(?:^|[\s,.;:!?…—-])(?:це\s+(?:все|всё|усе)|это\s+(?:все|всё)|все|всё|готово|стоп|done)[\s.,;:!?…]*$/iu;
export const endsWithStop = (s: string): boolean => STOP.test(s.trim());
export const withoutStop = (s: string): string => s.trim().replace(STOP, '').replace(/[\s,;:—–-]+$/u, '').trim();

const isNumber = (w: string) => /^\d+(?:[.,]\d+)?$/.test(w) || normalize(w) in NUMBER_WORDS;
// «ст.», «ч.», «л.» of «3 ст. л.» written after the food — still the measure, not a new food (D123)
const isMeasure = (w: string) => { const n = normalize(w).replace(/\.$/, ''); return MEASURES.some(([re]) => re.test(n)) || /^(ст|ч|л)$/u.test(n); };
/** Words after which a number belongs to what follows them, not to a new food: «з 2 ложками», «по 1 табл.». */
const GLUE = new Set(['з', 'із', 'зі', 'без', 'по', 'на', 'до', 'в', 'у', 'для', 'і', 'й', 'та', 'або', 'чи', 'ще', 'плюс', 'десь', 'майже', 'приблизно', 'близько']);
const foodWord = (w: string) => { const n = normalize(w); return !!n && !isNumber(w) && !isMeasure(w) && !w.includes('%') && !GLUE.has(n) && !NOT_FOOD.has(n.replace(/['’ʼ]/g, '')); };

/** D105: dictation has no commas — «250 г вівсянки 2 варених яйця 1 куряче стегно». A number starts a new food when a food
 *  came before it and a food (not only a measure) comes after: never «хліба 2 скибки», «з 2 ложками», «кефір 1 %». */
function splitOnAmounts(part: string): string[] {
  const ws = part.split(/\s+/).filter(Boolean);
  const out: string[][] = [[]];
  ws.forEach((w, i) => {
    const cur = out.at(-1)!;
    let j = i + 1;
    const after: string[] = [];
    while (j < ws.length && !isNumber(ws[j]!)) after.push(ws[j++]!);
    const starts = i > 0 && isNumber(w) && cur.some(foodWord) && foodWord(ws[i - 1]!) && after.some(foodWord);
    if (starts) out.push([w]); else cur.push(w);
  });
  return out.map((x) => x.join(' '));
}

export function splitPhrase(raw: string): string[] {
  // D84: a comma or dot inside a number («2,5 %») or inside brackets («(кріп, петрушка)») is not between two foods.
  // T3 (D85): a dot before a space (or the end) ends a part — before a capital, a digit or a small letter alike —
  // unless it closes an abbreviation («ст.», «ч. л.», «г.», «шт.», «конс.», «тощо»)
  const parts: string[] = [];
  let cur = '', depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!, prev = raw[i - 1] ?? '', next = raw[i + 1] ?? '';
    if (c === '(') depth++;
    if (c === ')') depth = Math.max(0, depth - 1);
    const inNumber = /\d/.test(prev) && /\d/.test(next);
    const word = /(\p{L}+)$/u.exec(cur)?.[1]?.toLocaleLowerCase('uk') ?? '';
    const sentence = c === '.' && /^(\s|$)/u.test(raw.slice(i + 1)) && !ABBR.has(word);
    if (depth === 0 && !inNumber && (c === ',' || c === ';' || sentence)) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.flatMap((p) => p.split(/\s+(?:і|й|та|и|ще|плюс|а також)\s+/iu)).flatMap(splitOnAmounts).map((s) => s.trim()).filter(Boolean);
}

const EDGE = /^(з|із|зі|без|по|на|до|в|у|для|і|й|та|або|чи)$/u;
/** D105: a part nothing was found for, said without a comma between two foods — «2 яйця кава з молоком» — read as two
 *  parts when both are found (the longer first part first). A half never begins or ends with «з», «без»…: «пиріжок з
 *  капустою» stays one part (and «не знайдено», for the person or the concierge), not «пиріжок» + «капуста». */
function twoFound(text: string, ctx: MealContext, depth = 0): string[] | undefined {
  const ws = text.split(/\s+/).filter(Boolean);
  if (ws.length < 2 || depth > 3) return undefined;
  for (let i = ws.length - 1; i >= 1; i--) {
    const l = ws.slice(0, i).join(' '), r = ws.slice(i).join(' ');
    if (EDGE.test(normalize(ws[i - 1]!)) || EDGE.test(normalize(ws[i]!)) || !ws.slice(0, i).some(foodWord)) continue;
    if (!candidates(l, ctx).list[0]) continue;
    if (candidates(r, ctx).list[0]) return [l, r];
    const rest = twoFound(r, ctx, depth + 1);
    if (rest) return [l, ...rest];
  }
  return undefined;
}

export interface Recognized {
  text: string;
  item?: MealItem; // undefined = nothing found for this part
  others?: MealItem[]; // D81: other foods the same words fit («хліб» → житній, цільнозерновий) — one tap to choose
  estimate?: boolean; // D32: not in the base — nutrients are the photo's estimate
  unsure?: boolean; // D32: the photo was hard to read
}

export interface MealContext { foods: Food[]; recipes: Recipe[]; dishItem: (r: Recipe, portions: number) => MealItem; prefer?: ReadonlySet<string> }
export interface Candidate { item: MealItem; food?: Food; recipe?: Recipe }

/** D105: a dish from what was said — «250 г» is grams (a portion's weight decides), as is a big bare number («гречка з
 *  куркою 300»); «2», «2 порції» — portions. It was read as 250 portions (85 kg). D106: said in grams, it is shown in grams. */
function dishFor(d: Recipe, q: Query, ctx: MealContext): MealItem {
  const qty = q.qty ?? 1;
  if (!(q.measure === 'г' || (!q.measure && qty > 20))) return ctx.dishItem(d, qty);
  const one = ctx.dishItem(d, 1).grams;
  const item = ctx.dishItem(d, one > 0 ? Math.max(0.01, Math.round((qty / one) * 100) / 100) : 1);
  return { ...item, recipe: { ...item.recipe!, byGrams: true } };
}

/** D85: what one part of the text can be, best first — dishes and foods in one order, by how closely the words fit;
 *  on an equal fit the dish whose name starts with the word (so «салат» is the salad, «огірок» the cucumber). */
export function candidates(text: string, ctx: MealContext): { q: Query; list: Candidate[] } {
  const q = parseQuery(text);
  if (!q.text) return { q, list: [] };
  const prefer = ctx.prefer ?? new Set<string>();
  const foods = searchFoods(ctx.foods, q.text, 8, prefer);
  const dishes = searchFoods(ctx.recipes, q.text, 4, prefer);
  const first = stem(normalize(q.text).split(' ')[0]!);
  const dishFirst = (d: Recipe, f: Food | undefined) => {
    if (!f) return true;
    const df = fit(d, q.text), ff = fit(f, q.text);
    return df[0] < ff[0] || (df[0] === ff[0] && df[1] <= ff[1] && normalize(d.name).startsWith(first));
  };
  const list: Candidate[] = [];
  let a = 0, b = 0;
  while (a < dishes.length || b < foods.length) {
    const d = dishes[a], f = foods[b];
    if (d && dishFirst(d, f)) { list.push({ item: dishFor(d, q, ctx), recipe: d }); a++; }
    else { list.push({ item: itemFor(f!, q), food: f! }); b++; }
  }
  return { q, list };
}

/** Each part of a phrase: the best candidate, and for a word alone the other kinds it may mean (no twins). */
export function recognizeWith(raw: string, ctx: MealContext): Recognized[] {
  return splitPhrase(withoutStop(raw)).flatMap((x) => (candidates(x, ctx).list[0] ? [x] : twoFound(x, ctx) ?? [x])).map((text) => {
    const { q, list } = candidates(text, ctx);
    const best = list[0];
    if (!best) return { text };
    const others = q.text.split(' ').length > 1 || best.recipe ? [] : list.slice(1)
      .filter((c, i, all) => c.food && c.item.name !== best.item.name && fit(c.food, q.text)[0] < 3 && all.findIndex((x) => x.item.name === c.item.name) === i)
      .slice(0, 3).map((c) => c.item);
    return { text, item: best.item, ...(others.length ? { others } : {}) };
  });
}

/** D85: what «Записати їжу» makes of the typed text — the one function the screen and the phrase corpus both call.
 *  Several parts → «Розпізнано» rows; one part → the same row on top, and the whole list to tap. */
export function readMeal(raw: string, ctx: MealContext): { rows: Recognized[]; list: Candidate[] | null } {
  const rows = recognizeWith(raw, ctx);
  return { rows, list: rows.length === 1 ? candidates(rows[0]!.text, ctx).list : null };
}

/** Each part of a phrase matched to a dish (when the words name one) or a food, with its amount. */
export function recognize(raw: string, foods: Food[], recipes: Recipe[], dishItem: (r: Recipe, portions: number) => MealItem,
  prefer: ReadonlySet<string> = new Set()): Recognized[] {
  return recognizeWith(raw, { foods, recipes, dishItem, prefer });
}
