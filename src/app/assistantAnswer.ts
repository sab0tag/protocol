// D166: one way to answer a question — the same on «Помічник» and in the one field on «Сьогодні». What the code does around the
// model (D117, D127–D132, D143): despair → the crisis card, a danger sign → the 103 card, both before any model; «що добрати?» →
// the code alone; the rest → the model with the day's numbers and the plan's rules, its foods turned into lines of the base and
// checked against the plan (what fails is neither shown nor named); a medicine, a symptom, the plan → the app's own words; a model
// saying «call now» → the 103 card. Nothing is written for the person: a suggestion goes to the evening as a planned snack.
import { rehabAnswer } from '../domain/rehabSafety';
import { format } from 'date-fns';
import { inDemo } from '../data/db';
import { keep, kept } from '../data/kept';
import { profileKey } from '../data/profiles';
import { dayContext, historyFor, lineOf, passing, routeQuestion, scrubTalk, shownReply, withoutDropped } from '../domain/assistant';
import { appVersion, planVersion } from '../domain/concierge';
import { atLocal, newId } from '../domain/dates';
import { passes } from '../domain/evaluate';
import { frequentItems } from '../domain/habits';
import { dayTotals, effectiveTargets } from '../domain/nutrition';
import { dishItem } from '../domain/recipes';
import { topups } from '../domain/topup';
import type { DayEntry, Food, MealItem, Plan, Recipe } from '../domain/types';
import { t } from '../i18n/uk';
import { ApiError, assistantChat } from '../sync/api';
import { currentKeys } from '../sync/runner';

const L = t.assistant;

export interface Msg { id: string; role: 'user' | 'assistant'; text: string; items?: MealItem[]; card?: 'danger' | 'crisis'; danger?: true; error?: true
  notOffered?: { name: string; reason: string; instead?: string }[] }
/** An answer: a card instead of words, a consent to ask first, or words with the suggestions that pass the plan. */
export type Reply = Omit<Msg, 'id' | 'role' | 'card' | 'danger'>;
export type Answer = { card: 'danger' | 'crisis' } | { consent: true } | Reply;

const CONSENT = profileKey('protocol.assistantConsent');
/** D117: a question goes to the model only after the person allowed it once (here or with sync's concierge consent). */
export const assistantConsented = (syncConsent?: boolean) => { try { return localStorage.getItem(CONSENT) === '1' || !!syncConsent; } catch { return !!syncConsent; } };
export const giveAssistantConsent = () => { try { localStorage.setItem(CONSENT, '1'); } catch { /* private mode */ } };

/** The day's talk, kept on this device for the day (D132: cleaned on reading). «Ще → Помічник» shows it. */
const TALK = (date: string) => `assistant:${date}`;
export const talkOf = (date: string) => scrubTalk(kept<Msg[]>(TALK(date)) ?? []);
export const keepTalk = (date: string, msgs: Msg[]) => keep(TALK(date), msgs);

export interface Day { plan: Plan; foods: Map<string, Food>; recipes: Recipe[]; all: DayEntry[]; date: string }
const dayOf = (d: Day) => d.all.filter((e) => e.at.startsWith(`${d.date}T`));
export const usualFoods = (all: DayEntry[], date: string) => frequentItems(all, date, 60, 50).map((f) => f.item.foodId ?? '').filter(Boolean);

/** Scenario 3 asked in words — the code's numbers and three things that pass the plan; no model. */
export function topupReply(d: Day): Reply {
  const entries = dayOf(d), targets = effectiveTargets(d.plan, d.date), totals = dayTotals(entries, d.foods);
  const tops = topups({ plan: d.plan, targets, date: d.date, now: format(new Date(), 'HH:mm'), foods: d.foods, usual: usualFoods(d.all, d.date), entries: d.all,
    mealsDone: entries.filter((e) => e.kind === 'meal' && e.status === 'done').length,
    have: { kcal: totals.kcal, protein: totals.protein, calciumMg: totals.calciumMg, carbs: totals.carbs } }, true);
  if (!tops.length) {
    const any = targets.kcal !== undefined || targets.proteinG !== undefined || targets.calciumMg !== undefined;
    return { text: !any ? L.noTargets : !entries.some((e) => e.kind === 'meal' && e.status === 'done') ? L.nothingRecorded : L.allReached };
  }
  const lines = tops.map((x) => t.topup.ask(t.topup.goals[x.goal], x.have, x.target, t.topup.units[x.goal]).replace(' Добрати до вечора?', ''));
  const items = [...new Map(tops.flatMap((x) => x.items).map((it) => [it.name, it])).values()].slice(0, 3);
  return { text: `${lines.join(' ')} ${L.canAdd}`, items };
}

/** One question, answered. `history` is the talk before it (only its words after the last card go, D130). */
export async function answer(words: string, d: Day, o: { consent: boolean; log: boolean; history: Msg[] }): Promise<Answer> {
  const route = routeQuestion(words, d.plan, d.date); // D130: by this question alone, not by the talk before it
  if (route === 'crisis' || route === 'danger') return { card: route };
  if (route === 'rehab') return { text: rehabAnswer(words, d.plan, d.date)! }; // D181: the plan's own words, never the model
  if (route === 'distress') return { text: t.goal.eating }; // D183
  if (route === 'topup') return topupReply(d);
  if (inDemo()) return { text: L.demo }; // D98
  if (!o.consent) return { consent: true };
  const entries = dayOf(d), targets = effectiveTargets(d.plan, d.date), totals = dayTotals(entries, d.foods);
  const usual = usualFoods(d.all, d.date);
  const names = [...[...d.foods.values()].map((f) => f.name), ...d.recipes.map((r) => r.name)];
  try {
    const r = await assistantChat(currentKeys() ?? null, { text: words, names, log: o.log && !!currentKeys(),
      history: historyFor(o.history.map((m) => ({ role: m.role, text: m.text, ...(m.card || m.danger ? { card: m.card ?? 'danger' } : {}) }))),
      context: dayContext(d.plan, targets, totals, format(new Date(), 'HH:mm'), usual.map((id) => d.foods.get(id)?.name ?? '').filter(Boolean)),
      versions: { app: appVersion(), plan: planVersion(d.plan) } });
    const reply = shownReply(r, d.plan); // D130: the model said to call now — the 103 card, never a softer «запишіть у звіт»
    if ('card' in reply) return { card: 'danger' };
    if (reply.fixed) return { text: reply.text };
    const lines = r.items.flatMap((x) => { const it = lineOf(x.name, x.grams, [...d.foods.values()], d.recipes, dishItem); return it ? [it] : []; });
    const { shown, dropped, why } = passing(lines, d.plan, d.date, d.foods, d.all); // what fails the plan in the real day is not shown (R03)
    const said = withoutDropped(r.text, dropped, shown.map((x) => x.name)); // R04: nor said
    const text = lines.length && !shown.length ? `${said ? `${said} ` : ''}${L.allDropped(dropped.join(', '))}` : said || L.empty;
    return { text, ...(shown.length ? { items: shown } : {}), ...(shown.length && why.length ? { notOffered: why } : {}) };
  } catch (e) {
    const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
    return { text: (L.errors as Record<string, string>)[code] ?? L.errors.other ?? '', error: true };
  }
}

/** A suggestion to the evening as a planned snack — never what was eaten (boundary 5). Checked again now (R03): the day may have
 *  changed since the answer; then there is nothing to add and the caller says so. */
export function eveningSnack(it: MealItem, d: Day): DayEntry | undefined {
  if (!passes({ plan: d.plan, date: d.date, foods: d.foods, entries: d.all }, it)) return undefined;
  const by = effectiveTargets(d.plan, d.date).lastMealBy ?? '20:00', later = format(new Date(Date.now() + 900_000), 'HH:mm');
  return { id: newId(), at: atLocal(d.date, later < by ? later : by), kind: 'meal', status: 'planned', title: t.topup.snack, items: [it] };
}
