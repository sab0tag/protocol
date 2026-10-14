// «Мені погано» (SPEC.md D56): a symptom with its time, and what was eaten in the hours before it — the food and
// symptom diary a gastroenterologist or an allergist asks for. Nothing here decides anything: it shows what was
// recorded, side by side. Danger signs are named so the screen can say «телефонуйте 103» at once. Pure.
import { byAt } from './dates';
import { flatItems } from './rules';
import type { Allergen, DayEntry, Food } from './types';
import { t } from '../i18n/uk';

/** Common ones first; «своє» can be typed. */
export const SYMPTOMS = ['Здуття', 'Печія', 'Нудота', 'Біль у животі', 'Тяжкість після їжі', 'Біль у правому боці', 'Діарея',
  'Висип', 'Свербіж', 'Головний біль', 'Втома'] as const;

/** Signs of a reaction that can be dangerous — not something to note and wait. */
export const DANGER = ['Набряк губ, язика чи горла', 'Важко дихати', 'Висип по всьому тілу', 'Різка слабкість чи запаморочення'] as const;

export const isDanger = (s: string) => (DANGER as readonly string[]).includes(s);

/** How far back «що їли перед цим» looks. */
export const BEFORE_HOURS = 6;

/** Meals eaten (done) within `hours` before `at`, the latest first — across midnight too. */
export function eatenBefore(entries: DayEntry[], at: string, hours = BEFORE_HOURS): DayEntry[] {
  const t = Date.parse(at), from = t - hours * 3_600_000;
  return entries
    .filter((e) => e.kind === 'meal' && e.status === 'done' && !e.timeUnknown && Date.parse(e.at) <= t && Date.parse(e.at) >= from)
    .sort((a, b) => byAt(b, a));
}

// ------------------------------------------------------------------ coincidences (D59)
/** What a meal is compared by: the 14 allergens, alcohol, fried food. */
export type FoodGroup = Allergen | 'alcohol' | 'fried';
export const MIN_EVENTS = 3; // a symptom recorded at least this often
const MIN_SHARE = 0.6, MIN_LIFT = 0.2;

function groupsOf(meals: DayEntry[], foods: Map<string, Food>): Set<FoodGroup> {
  const out = new Set<FoodGroup>();
  for (const m of meals) for (const it of flatItems(m.items)) {
    const f = it.foodId ? foods.get(it.foodId) : undefined;
    for (const a of f?.allergens ?? []) out.add(a);
    if (f?.tags.includes('alcohol')) out.add('alcohol');
    if (it.cooking === 'fried' || /смажен/i.test(it.name)) out.add('fried');
  }
  return out;
}

export interface Coincidence { symptom: string; group: FoodGroup; hits: number; events: number; baselinePct: number }

/** D59: «Здуття» — 5 з 6 разів протягом 6 год після продуктів з молоком; такі продукти були в 40 % днів із записами.
 *  Counted, not concluded: only when the symptom was recorded MIN_EVENTS+ times, the group came before it in at least
 *  60 % of them (and MIN_EVENTS+ times), and that is clearly more often than on an ordinary recorded day. */
export function coincidences(entries: DayEntry[], foods: Map<string, Food>): Coincidence[] {
  const eaten = entries.filter((e) => e.kind === 'meal' && e.status === 'done' && !e.timeUnknown);
  const byDay = new Map<string, DayEntry[]>();
  for (const m of eaten) byDay.set(m.at.slice(0, 10), [...(byDay.get(m.at.slice(0, 10)) ?? []), m]);
  const dayGroups = [...byDay.values()].map((ms) => groupsOf(ms, foods));
  const baseline = (g: FoodGroup) => (dayGroups.length ? dayGroups.filter((s) => s.has(g)).length / dayGroups.length : 0);

  const events = new Map<string, Set<FoodGroup>[]>();
  for (const e of entries) {
    if (e.kind !== 'symptom') continue;
    const before = groupsOf(eatenBefore(eaten, e.at), foods);
    for (const s of e.symptoms ?? []) events.set(s, [...(events.get(s) ?? []), before]);
  }
  const out: Coincidence[] = [];
  for (const [symptom, list] of events) {
    if (list.length < MIN_EVENTS) continue;
    const seen = new Set(list.flatMap((g) => [...g]));
    for (const group of seen) {
      const hits = list.filter((g) => g.has(group)).length, share = hits / list.length, base = baseline(group);
      if (hits >= MIN_EVENTS && share >= MIN_SHARE && share - base >= MIN_LIFT)
        out.push({ symptom, group, hits, events: list.length, baselinePct: Math.round(base * 100) });
    }
  }
  return out.sort((a, b) => b.hits / b.events - a.hits / a.events || b.hits - a.hits);
}

const after = (g: FoodGroup) => (g === 'alcohol' ? 'алкоголю' : g === 'fried' ? 'смаженого' : `продуктів, що містять: ${t.allergen.name[g]}`);
/** One line, the same words in «Прогрес» and in the report: counted, with the ordinary rate beside it. */
export const coincidenceText = (c: Coincidence) =>
  `«${c.symptom}» — ${c.hits} з ${c.events} разів протягом ${BEFORE_HOURS} год після ${after(c.group)}; на звичайний день із записами — ${c.baselinePct} %`;
