// D95: the voice window (M5) — one utterance into one draft, then commands on the same draft. Not a chat and not a second
// logic: food goes through readMeal (the same reading as the typed field), the plan check through src/domain/rules, a
// medicine is matched to the plan's own prescriptions, water by its words. A quantity nobody said is shown and asked,
// never taken for granted; nothing is written until the person taps «Записати».
import { fold } from './meds';
import { candidates, parseQuery, readMeal, sameWord, splitPhrase, type MealContext } from './foodSearch';
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
export function readUtterance(text: string, ctx: VoiceContext, into: VoiceDraft = emptyDraft()): VoiceDraft {
  const d: VoiceDraft = { ...into, items: [...into.items], notFound: [...into.notFound], meds: [...into.meds] };
  if (!d.title) d.title = TITLES.find(([re]) => re.test(text))?.[1];
  for (const raw of splitPhrase(text)) {
    const water = waterOf(raw);
    if (water !== undefined) { d.waterMl += water; continue; }
    const med = medOf(raw, ctx);
    if (med) { if (!d.meds.some((m) => m.key === med.key)) d.meds.push(med); continue; }
    const said = clean(raw.replace(/^(?:на\s+)?(?:сніданок|обід|вечерю|перекус)\s*/iu, ''));
    if (!said) continue;
    const r = readMeal(said, ctx).rows[0];
    if (!r?.item) { d.notFound.push(said); continue; }
    const q = parseQuery(said);
    // said, or a natural one (a cup of coffee, an apple, a slice) — a portion or grams nobody said is asked, not assumed
    const natural = !!r.item.unit && ['склянка', 'шт', 'скибка'].includes(r.item.unit.name);
    d.items.push({ item: r.item, said, sure: q.qty !== undefined || !!q.measure || natural, ...(r.others ? { others: r.others } : {}) });
  }
  return d;
}

const names = (it: MealItem) => normalize(it.name).split(/[\s(),/%]+/).filter(Boolean);
const mentions = (said: string, it: MealItem) => normalize(said).split(/\s+/).some((w) => w.length >= 3 && names(it).some((n) => sameWord(w, n) || n.startsWith(w)));

/** A command on the current draft — «прибери молоко», «хліба було 40 грамів», «додай яблуко», «як учора» — or null if
 *  the words are not a command (then they are read as more of the meal). */
export function applyCommand(text: string, d: VoiceDraft, ctx: VoiceContext): VoiceDraft | null {
  const s = text.trim();
  const remove = /^(?:прибери|прибрати|видали|забери|прибрати|без)\s+(.+)$/iu.exec(s);
  if (remove) {
    const what = remove[1]!;
    const items = d.items.filter((x) => !mentions(what, x.item));
    const meds = d.meds.filter((m) => !fold(what).split(' ').some((w) => w.length >= 3 && fold(m.title).includes(w)));
    const water = /вод/iu.test(what) ? 0 : d.waterMl;
    return items.length === d.items.length && meds.length === d.meds.length && water === d.waterMl ? d : { ...d, items, meds, waterMl: water };
  }
  // «хліба було 40 грамів», «кави дві склянки», «гречки 150 г»
  const amount = /^(.+?)\s+(?:було|був|була|були)?\s*((?:\d+(?:[.,]\d+)?|[\p{L}]+)\s*(?:г|гр|грам\S*|мл|склян\S*|шт|штук\S*|порці\S*|ложк\S*|скиб\S*|шмат\S*))$/iu.exec(s);
  if (amount) {
    const i = d.items.findIndex((x) => mentions(amount[1]!, x.item));
    if (i >= 0) {
      const prev = d.items[i]!;
      const re = candidates(`${amount[2]} ${prev.item.name}`, ctx).list.find((c) => c.item.name === prev.item.name);
      if (re) return { ...d, items: d.items.map((x, j) => (j === i ? { ...x, item: re.item, sure: true } : x)) };
    }
  }
  const add = /^(?:додай|додати|ще)\s+(.+)$/iu.exec(s);
  if (add) return readUtterance(add[1]!, ctx, d);
  if (/як\s+(?:у|в)чора/iu.test(s)) {
    const title = d.title ?? TITLES.find(([re]) => re.test(s))?.[1];
    const meal = ctx.yesterday.filter((e) => e.kind === 'meal' && e.status === 'done' && e.items?.length && (!title || e.title === title)).at(-1);
    if (!meal) return d;
    return { ...d, title: d.title ?? meal.title, items: [...d.items, ...meal.items!.map((item) => ({ item: { ...item }, said: 'як учора', sure: true }))] };
  }
  return null;
}

/** Speak again: a command if it is one, else more of the same meal. */
export const hear = (text: string, d: VoiceDraft, ctx: VoiceContext) => applyCommand(text, d, ctx) ?? readUtterance(text, ctx, d);

/** Ready to write: something in it, and every quantity either said or confirmed by a tap. */
export const ready = (d: VoiceDraft) => (d.items.length > 0 || d.meds.length > 0 || d.waterMl > 0) && d.items.every((x) => x.sure);
