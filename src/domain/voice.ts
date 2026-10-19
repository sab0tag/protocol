// D95: the voice window (M5) — one utterance into one draft, then commands on the same draft. Not a chat and not a second
// logic: food goes through readMeal (the same reading as the typed field), the plan check through src/domain/rules, a
// medicine is matched to the plan's own prescriptions, water by its words. A quantity nobody said is shown and asked,
// never taken for granted; nothing is written until the person taps «Записати».
import { fold } from './meds';
import { amountText, candidates, parseQuery, readMeal, sameWord, splitPhrase, withoutStop, type MealContext } from './foodSearch';
import { setPortions } from './recipes';
import { t } from '../i18n/uk';
import { normalize } from './nutrition';
import type { DayEntry, MealItem, Prescription } from './types';

export interface DraftItem { item: MealItem; said: string; sure: boolean; others?: MealItem[] }
export interface DraftMed { key: string; title: string; prescriptionId?: string }
export interface VoiceDraft { title?: string; items: DraftItem[]; notFound: string[]; meds: DraftMed[]; waterMl: number }
export interface VoiceContext extends MealContext {
  meds: DraftMed[]; // today's medicines from the checklist (key «med:<id>:<time>»), the ones to mark
  prescriptions: Prescription[];
  yesterday: DayEntry[]; // yesterday's meals, for «як учора»
}

export const emptyDraft = (): VoiceDraft => ({ items: [], notFound: [], meds: [], waterMl: 0 });

const TITLES: [RegExp, string][] = [[/сніданок|сніданку|снідан/iu, 'Сніданок'], [/обід|обіду|обідал/iu, 'Обід'], [/вечер[яюі]|вечеряв/iu, 'Вечеря'], [/перекус/iu, 'Перекус']];
/** Words around the food that are not food: «на сніданок я з'їв …», «ще випила …». */
const FILLER = /^(?:(?:на|в|у|до)\s+(?:сніданок|обід|вечерю|перекус)\s*)?(?:я\s+)?(?:ще\s+)?(?:з[’'ʼ]?їв|з[’'ʼ]?їла|з[’'ʼ]?їли|їв|їла|випив|випила|випили|пив|пила|був|була|було|були|поїв|поїла|перекусив|перекусила|снідав|снідала|обідав|обідала|вечеряв|вечеряла)?\s*/iu;
const MED_VERB = /(?:прийняв|прийняла|випив|випила|випили)\s+(?:таблетк\S*\s+)?/iu;
const V = t.voice.cmd;
const NUM: Record<string, number> = { одну: 1, одна: 1, один: 1, дві: 2, два: 2, три: 3, чотири: 4, пів: 0.5, півтори: 1.5 };

/** «склянку води», «дві склянки води», «пів літра води», «300 мл води» → ml; undefined if the clause is not water. */
export function waterOf(clause: string): number | undefined {
  const s = normalize(clause);
  if (!/(^|\s)вод[аиуі](?=\s|$)/u.test(s)) return undefined; // \b knows no Cyrillic
  const n = /(\d+(?:[.,]\d+)?)\s*(мл|л|літр\S*)?/u.exec(s);
  if (n) { const v = Number(n[1]!.replace(',', '.')); return n[2]?.startsWith('л') ? Math.round(v * 1000) : n[2] === 'мл' || v > 20 ? Math.round(v) : Math.round(v * 250); }
  const w = Object.entries(NUM).find(([k]) => new RegExp(`(^|\\s)${k}(\\s|$)`, 'u').test(s))?.[1] ?? 1;
  return /літр/u.test(s) ? Math.round(w * 1000) : Math.round(w * 250);
}

/** A medicine of today's plan named in the clause («вітамін д випив», «прийняв еутирокс»). */
export function medOf(clause: string, ctx: Pick<VoiceContext, 'meds'>): DraftMed | undefined {
  const s = fold(clause.replace(MED_VERB, ''));
  return ctx.meds.find((m) => {
    const ws = fold(m.title).split(' ').filter((w) => w.length >= 2);
    return ws.length > 0 && ws.every((w) => s.split(' ').some((x) => x === w || (w.length >= 4 && x.startsWith(w.slice(0, -1)))));
  });
}

const clean = (clause: string) => clause.replace(FILLER, '').replace(/^(?:і|й|та|ще|а)\s+/iu, '').trim();

/** One utterance → what it adds to a draft. */
export function readUtterance(spoken: string, ctx: VoiceContext, into: VoiceDraft = emptyDraft()): VoiceDraft {
  let text = withoutStop(spoken); // D105: «…це все» ends the dictation, it is not food
  const d: VoiceDraft = { ...into, items: [...into.items], notFound: [...into.notFound], meds: [...into.meds] };
  const meal = MEAL_SAID.exec(text); // D107: «два яйця, це було на сніданок» — the meal, said after the food
  if (meal) { d.title = MEAL_OF[meal[1]!.toLowerCase()]; text = text.slice(0, meal.index).trim(); }
  if (!d.title) d.title = TITLES.find(([re]) => re.test(text))?.[1];
  for (const raw of splitPhrase(text)) {
    const water = waterOf(raw);
    if (water !== undefined) { d.waterMl += water; continue; }
    const med = medOf(raw, ctx);
    if (med) { if (!d.meds.some((m) => m.key === med.key)) d.meds.push(med); continue; }
    const clause = clean(raw.replace(/^(?:на\s+)?(?:сніданок|обід|вечерю|перекус)\s*/iu, ''));
    if (!clause) continue;
    for (const r of readMeal(clause, ctx).rows) { // D105: «2 яйця кава з молоком» — one clause, two foods
      const said = clean(r.text);
      if (!said) continue;
      if (!r.item) { d.notFound.push(said); continue; }
      const q = parseQuery(said);
      // said, or a natural one (a cup of coffee, an apple, a slice) — a portion or grams nobody said is asked, not assumed
      const natural = !!r.item.unit && ['склянка', 'шт', 'скибка'].includes(r.item.unit.name);
      d.items.push({ item: r.item, said, sure: q.qty !== undefined || !!q.measure || natural, ...(r.others ? { others: r.others } : {}) });
    }
  }
  return d;
}

const names = (it: MealItem) => normalize(it.name).split(/[\s(),/%]+/).filter(Boolean);
const said = (w: string, n: string) => w.length >= 3 && (sameWord(w, n) || n.startsWith(w) || (w.length >= 4 && n.startsWith(w.slice(0, -1))));
const mentions = (what: string, it: MealItem) => normalize(what).split(/\s+/).some((w) => names(it).some((n) => said(w, n)));
/** Which word of the item's name the words name — 0 is its head («каву» → «Кава з молоком»), more is a part («курку» →
 *  «Гречка з куркою»); -1 none. */
const named = (what: string, it: MealItem) => {
  const ws = normalize(what).split(/\s+/);
  return names(it).findIndex((n) => ws.some((w) => said(w, n)));
};

// ------------------------------------------------------------------ D107: commands on the draft
/** Asked before taking a part out of a dish: the whole dish, or the dish without that part. */
export interface Ask { index: number; part: string; whole: string; instead?: MealItem }
/** The draft, the drafts before each change (for «скасуй»), what the last change did, a question waiting, a clear to confirm. */
export interface VoiceSession { draft: VoiceDraft; history: VoiceDraft[]; note?: string; ask?: Ask; confirmClear?: true }
export const newSession = (): VoiceSession => ({ draft: emptyDraft(), history: [] });
type Done = { d: VoiceDraft; note?: string; ask?: Ask; undo?: true; clear?: true };

const NUMBER = /^(?:\d+(?:[.,]\d+)?|одне|один|одна|одну|два|дві|три|чотири|п[’']?ять|шість|сім|вісім|десять|пів|півтори|півтора)$/iu;
const MEAL_OF: Record<string, string> = { сніданок: 'Сніданок', обід: 'Обід', вечерю: 'Вечеря', вечеря: 'Вечеря', перекус: 'Перекус' };
const MEAL_SAID = /(?:^|\s|,)\s*(?:це\s+)?(?:було\s+)?(?:на|в|у)\s+(сніданок|обід|вечерю|перекус)\s*$/iu;

/** The item with another amount — «3» of its own measure, «40 г», «2 порції». */
function setAmount(it: MealItem, q: { qty?: number; measure?: string }, ctx: VoiceContext): MealItem | undefined {
  const qty = q.qty;
  if (qty === undefined || !(qty > 0)) return undefined;
  if (it.recipe) {
    if (q.measure !== 'г') return setPortions(it, qty);
    const p = setPortions(it, Math.max(0.01, Math.round((qty / (it.grams / it.recipe.portions)) * 100) / 100));
    return { ...p, recipe: { ...p.recipe!, byGrams: true } };
  }
  if (it.unit && (!q.measure || q.measure === it.unit.name)) return { ...it, grams: Math.round(qty * it.unit.grams), unit: { ...it.unit, qty } };
  if (q.measure === 'г' || (!q.measure && !it.unit)) { const { unit: _u, ...rest } = it; return { ...rest, grams: Math.round(qty) }; }
  return candidates(`${qty} ${q.measure ?? ''} ${it.name}`, ctx).list.find((c) => c.item.name === it.name)?.item;
}

/** One more of the same: the amounts add up in one line («ще 2 яйця» → 4 шт, not a second line of eggs). */
function addTo(a: MealItem, b: MealItem): MealItem | undefined {
  if (a.recipe && b.recipe && a.recipe.id === b.recipe.id) return setPortions(a, a.recipe.portions + b.recipe.portions);
  if (a.unit && b.unit && a.unit.name === b.unit.name) return { ...a, grams: a.grams + b.grams, unit: { ...a.unit, qty: a.unit.qty + b.unit.qty } };
  if (!a.unit && !b.unit && !a.recipe && !b.recipe) return { ...a, grams: a.grams + b.grams };
  return undefined;
}

const list = (xs: string[]) => xs.join(', ');

function remove(what: string, d: VoiceDraft, ctx: VoiceContext, strict: boolean): Done | null {
  const hit = d.items.map((x, i) => ({ x, i, at: named(what, x.item) })).filter((h) => h.at >= 0);
  const meds = d.meds.filter((m) => fold(what).split(' ').some((w) => w.length >= 3 && fold(m.title).includes(w)));
  const water = /вод/iu.test(what) && d.waterMl > 0;
  if (!hit.length && !meds.length && !water) return strict ? { d, note: V.missing(what) } : null; // «без цукру чай» is food
  const part = hit.find((h) => h.at > 0 && hit.length === 1);
  if (part) { // «прибери курку» with «Гречка з куркою»: the whole dish, or the dish without it — asked, never guessed
    const ws = names(part.x.item);
    const head = ws.slice(0, part.at).filter((w) => !/^(з|із|зі|без|та|і|й)$/u.test(w)).join(' ');
    const instead = head ? candidates(head, ctx).list.find((c) => c.item.name !== part.x.item.name)?.item : undefined;
    return { d, ask: { index: part.i, part: what, whole: part.x.item.name, ...(instead ? { instead } : {}) } };
  }
  const gone = new Set(hit.map((h) => h.i));
  const names_ = [...hit.map((h) => h.x.item.name), ...meds.map((m) => m.title), ...(water ? [V.waterWord] : [])];
  return { d: { ...d, items: d.items.filter((_, i) => !gone.has(i)), meds: d.meds.filter((m) => !meds.includes(m)), waterMl: water ? 0 : d.waterMl },
    note: V.removed(list(names_)) };
}

/** The line of the draft the words name — by its words, or by what the base finds for them («яєць» → Яйце варене). */
function lineOf(words: string, d: VoiceDraft, ctx: VoiceContext): number {
  const i = d.items.findIndex((x) => mentions(words, x.item));
  if (i >= 0 || !words.trim()) return i;
  const found = candidates(words, ctx).list.map((c) => c.item.name); // any of them: «яєць» finds «Омлет з 2 яєць» first, the egg too
  return d.items.findIndex((x) => found.includes(x.item.name));
}

function fix(rest: string, d: VoiceDraft, ctx: VoiceContext): Done {
  const q = parseQuery(rest);
  const i = q.text ? lineOf(q.text, d, ctx) : d.items.length - 1;
  const it = d.items[i];
  if (!it) return { d, note: V.missing(q.text || rest) };
  const next = setAmount(it.item, q, ctx);
  if (!next) return { d, note: V.missing(rest) };
  return { d: { ...d, items: d.items.map((x, j) => (j === i ? { ...x, item: next, sure: true } : x)) }, note: V.changed(next.name, amountText(next)) };
}

/** A command at the start of what was said, or null — then the words are more of the meal. A command whose target is not
 *  in the draft adds nothing: it says so («у чернетці немає»), never a line «не знайдено» (D107). */
export function command(text: string, d: VoiceDraft, ctx: VoiceContext): Done | null {
  const s = text.trim().replace(/[.!?]+$/u, '');
  if (/^(?:скасуй|скасувати|відміни|відмінити|поверни)(?:\s+(?:останнє|останню|це|назад))?$/iu.test(s)) return { d, undo: true };
  if (/^(?:(?:все|усе)\s+(?:заново|спочатку)|очисти(?:ти)?(?:\s+(?:все|усе|чернетку))?|почни\s+(?:заново|спочатку))$/iu.test(s)) return { d, clear: true };
  const meal = /^(?:це\s+)?(?:було\s+)?(?:на|в|у)\s+(сніданок|обід|вечерю|вечеря|перекус)$/iu.exec(s);
  if (meal) { const title = MEAL_OF[meal[1]!.toLowerCase()]!; return { d: { ...d, title }, note: V.meal(title) }; }
  const rm = /^(?:прибери|прибрати|видали|видалити|забери|забрати)\s+(.+)$/iu.exec(s);
  if (rm) return remove(rm[1]!, d, ctx, true);
  const without = /^без\s+(.+)$/iu.exec(s);
  if (without) { const r = remove(without[1]!, d, ctx, false); if (r) return r; }
  const instead = /^замість\s+(.+)$/iu.exec(s) ?? /^не\s+(?!\d)(\S.*?)\s*,?\s+а\s+(.+)$/iu.exec(s);
  if (instead && !(instead[2] && NUMBER.test(instead[1]!.split(/\s+/)[0]!.replace(/[,;]$/u, '')))) {
    const ws = (instead[2] ? `${instead[1]} ${instead[2]}` : instead[1]!).split(/\s+/);
    // «замість кави чай», «замість гречки з куркою рис»: the words naming a line of the draft, then what comes instead
    const names_ = (w: string) => d.items.some((x) => named(w, x.item) >= 0);
    let k = instead[2] ? instead[1]!.split(/\s+/).length : 0;
    if (!instead[2]) {
      while (k < ws.length - 1 && (names_(ws[k]!) || (/^(з|із|зі|без)$/iu.test(ws[k]!) && names_(ws[k + 1] ?? '')))) k += names_(ws[k]!) ? 1 : 2;
      k = Math.max(1, Math.min(k, ws.length - 1));
    }
    const was = ws.slice(0, k).join(' '), now = ws.slice(k).join(' ').replace(/^[—–,-]\s*/u, '');
    const i = d.items.findIndex((x) => mentions(was, x.item));
    if (i < 0) return { d, note: V.missing(was) };
    if (!now) return { d, note: V.missing(was) };
    const add = readUtterance(now, ctx);
    const old = d.items[i]!.item.name;
    const items = [...d.items.slice(0, i), ...add.items, ...d.items.slice(i + 1)];
    return { d: { ...d, items, notFound: [...d.notFound, ...add.notFound] }, note: V.replaced(old, list(add.items.map((x) => x.item.name)) || now) };
  }
  const notN = /^не\s+([^\s,;]+)\s*[,;]?\s*а\s+(.+)$/iu.exec(s);
  if (notN && NUMBER.test(notN[1]!)) return fix(notN[2]!, d, ctx);
  const make = /^(?:зроби|зробити|постав|хай\s+буде|нехай\s+буде|має\s+бути)\s+(.+)$/iu.exec(s);
  if (make) return fix(make[1]!, d, ctx);
  // «хліба було 40 грамів», «яєць 3», «кави дві склянки» — a food of the draft and its amount
  const amount = /^(.+?)\s+(?:було|був|була|були)?\s*((?:\d+(?:[.,]\d+)?|[\p{L}’']+)(?:\s*(?:г|гр|грам\S*|мл|склян\S*|шт|штук\S*|порці\S*|ложк\S*|скиб\S*|шмат\S*))?)$/iu.exec(s);
  const ai = amount && NUMBER.test(amount[2]!.split(/\s+/)[0]!) ? lineOf(amount[1]!.replace(/\s+(?:було|був|була|були)$/iu, ''), d, ctx) : -1;
  if (amount && ai >= 0) {
    const i = ai;
    const next = setAmount(d.items[i]!.item, parseQuery(amount[2]!), ctx);
    if (next) return { d: { ...d, items: d.items.map((x, j) => (j === i ? { ...x, item: next, sure: true } : x)) }, note: V.changed(next.name, amountText(next)) };
  }
  const more = /^(?:додай|додати|ще)\s+(.+)$/iu.exec(s);
  if (more) {
    const rest = more[1]!;
    const last = d.items.at(-1);
    if (/^(?:одне|один|одна|одну|одного|раз|1)$/iu.test(rest) && last) { // «ще одне» — one more of the last
      const one = last.item.recipe ? setPortions(last.item, last.item.recipe.portions + 1) : last.item.unit ? addTo(last.item, { ...last.item, grams: last.item.unit.grams, unit: { ...last.item.unit, qty: 1 } }) : undefined;
      if (one) return { d: { ...d, items: [...d.items.slice(0, -1), { ...last, item: one }] }, note: V.changed(one.name, amountText(one)) };
    }
    const add = readUtterance(rest, ctx);
    let items = [...d.items];
    const notes: string[] = [];
    for (const x of add.items) {
      const j = items.findIndex((y) => y.item.name === x.item.name);
      const sum = j >= 0 ? addTo(items[j]!.item, x.item) : undefined;
      if (sum) { items = items.map((y, k) => (k === j ? { ...y, item: sum, sure: y.sure && x.sure } : y)); notes.push(V.changed(sum.name, amountText(sum))); }
      else { items.push(x); notes.push(V.added(x.item.name)); }
    }
    const merged: VoiceDraft = { ...d, items, notFound: [...d.notFound, ...add.notFound], meds: [...d.meds, ...add.meds.filter((m) => !d.meds.some((x) => x.key === m.key))], waterMl: d.waterMl + add.waterMl };
    return { d: merged, ...(notes.length ? { note: notes.join('; ') } : {}) };
  }
  if (/як\s+(?:у|в)чора/iu.test(s)) {
    const title = d.title ?? TITLES.find(([re]) => re.test(s))?.[1];
    const meal = ctx.yesterday.filter((e) => e.kind === 'meal' && e.status === 'done' && e.items?.length && (!title || e.title === title)).at(-1);
    if (!meal) return { d, note: V.noYesterday };
    return { d: { ...d, title: d.title ?? meal.title, items: [...d.items, ...meal.items!.map((item) => ({ item: { ...item }, said: 'як учора', sure: true }))] }, note: V.added(list(meal.items!.map((x) => x.name))) };
  }
  return null;
}

/** Kept for the callers that only need the draft: a command if it is one, else more of the same meal. */
export function applyCommand(text: string, d: VoiceDraft, ctx: VoiceContext): VoiceDraft | null {
  return command(text, d, ctx)?.d ?? null;
}

/** D107: one step of the voice window — what was said or typed, applied to the session: a change goes on the history
 *  (so «скасуй» brings the draft before it back), a question or a clear waits for a tap, nothing is ever written. */
export function step(prev: VoiceSession, text: string, ctx: VoiceContext): VoiceSession {
  const s: VoiceSession = { draft: prev.draft, history: prev.history }; // a question, a clear or a note do not outlive the next words
  const words = withoutStop(text);
  if (!words) return prev;
  const c = command(words, s.draft, ctx);
  if (c?.undo) {
    const prev = s.history.at(-1);
    return prev ? { draft: prev, history: s.history.slice(0, -1), note: V.undone } : { ...s, note: V.nothingToUndo };
  }
  if (c?.clear) return { ...s, confirmClear: true };
  if (c?.ask) return { ...s, ask: c.ask };
  if (c) return c.d === s.draft ? { ...s, ...(c.note ? { note: c.note } : {}) } : { draft: c.d, history: [...s.history, s.draft], ...(c.note ? { note: c.note } : {}) };
  return { draft: readUtterance(words, ctx, s.draft), history: [...s.history, s.draft] };
}

/** A change made by a tap (a quantity chosen, a line taken out, the answer to a question) — on the history too. */
export const change = (s: VoiceSession, d: VoiceDraft, note?: string): VoiceSession => ({ draft: d, history: [...s.history, s.draft], ...(note ? { note } : {}) });

/** Speak again: a command if it is one, else more of the same meal. */
export const hear = (text: string, d: VoiceDraft, ctx: VoiceContext) => step({ draft: d, history: [] }, text, ctx).draft;

/** Ready to write: something in it, every quantity said or confirmed by a tap, and nothing said left unread — a line not
 *  found is either matched (the concierge) or taken out on purpose; it is never dropped silently (D97). */
export const ready = (d: VoiceDraft) => (d.items.length > 0 || d.meds.length > 0 || d.waterMl > 0) && d.items.every((x) => x.sure) && d.notFound.length === 0;
