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

/** D91: a danger sign written in free text — the concierge shows the 103 card instead of any answer of its own. D130: wider —
 *  the chest pressing, burning or squeezing, the pain going to the arm, jaw or shoulder blade, breathlessness, a numb or drooping
 *  face, a numb arm, fainting; Ukrainian and Russian (people write both). */
const CHEST = '(?:груд(?:ях|ях|і|ина|ини)?|грудь|груди|грудине|серц\\S*)';
const DANGER_WORDS = [
  /важко\s+дихати|не\s+можу\s+дихати|задиха|задуха|трудно\s+дышать|не\s+могу\s+дышать|удушь/iu,
  /набр[яе]к\S*\s+(губ|язик|горл|облич)/iu, /(губ|язик|горло)\S*\s+набряк/iu, /отек\S*\s+(губ|язык|горл|лиц)/iu,
  /висип\S*\s+по\s+(всьому\s+)?тілу/iu, /сып\S*\s+по\s+(всему\s+)?телу/iu,
  /запаморочен|непритом|втрат\S*\s+свідом|потер\S*\s+сознан|теря\S*\s+сознан|обморок/iu,
  new RegExp(`(?:бол\\S*|біль|тисне|тиснув|тиск\\S*|давит|давило|давление|пече|печет|жме|жжет|стискає|сжимает)\\s+(?:\\S+\\s+)?(?:у|в|за)\\s+${CHEST}`, 'iu'),
  /відда\S*\s+(?:в|у)\s+(?:ліву\s+|праву\s+)?(?:рук|щелеп|лопатк|шию)|отда\S*\s+(?:в|во)\s+(?:левую\s+|правую\s+)?(?:рук|челюст|лопатк|шею)/iu,
  /онімі\S*\s+(?:обличч|рук|ног|половин)|німіє\s+(?:обличч|рук)|онемен\S*\s+(?:лиц|рук|ног)|немеет\s+(?:лицо|рука)/iu,
  /перекос\S*\s+(?:обличч|лиц|рот)|обличчя\s+перекос|лицо\s+перекос/iu,
];
export const dangerInText = (text: string) => DANGER_WORDS.some((re) => re.test(text));

/** D130: words of despair — the crisis card (Lifeline Ukraine 7333, 112), never a model's answer and never «запишіть у звіт». */
const CRISIS_WORDS = /не\s+хоч\S*\s+(?:більше\s+|больше\s+)?(?:жити|жить)|покінчит\S*\s+(?:з|із)\s+собою|покончит\S*\s+с\s+собой|(?:немає|нема|нет)\s+сенсу\s+жити|нет\s+смысла\s+жить|хоч\S*\s+(?:померти|вмерти|умереть)|вбити\s+себе|вбʼ?ю\s+себе|убить\s+себя|суїцид|суицид|накласти\s+на\s+себе\s+руки|наложить\s+на\s+себя\s+руки/iu;
export const crisisInText = (text: string) => CRISIS_WORDS.test(text);

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
