// D92: the concierge, scenarios 3–4 — code only. «Білка 85 з 140 г. Добрати до вечора?» and «Вуглеводів 170 з 190 г — на
// вечерю краще без гарніру»: the numbers are the code's, the candidates pass the whole plan check, are ready in minutes and
// come from what the person usually eats first. Silent without a target in the plan (a doctor may limit protein), without
// a meal recorded at midday, after the last meal of the day, or once answered today. A tap puts it in the evening's plan,
// never in what was eaten.
import { checkMeal } from './rules';
import { itemFor } from './foodSearch';
import { itemNutrients } from './nutrition';
import type { Food, MealItem, Plan, Targets } from './types';

export type TopGoal = 'kcal' | 'proteinG' | 'calciumMg'; // D116: calories too
export interface Topup { kind: 'topup'; goal: TopGoal; have: number; target: number; gap: number; items: MealItem[] }
export interface NearLimit { kind: 'limit'; have: number; max: number; left: number }

export interface DayState {
  plan: Plan; targets: Targets; date: string;
  have: { kcal: number; protein: number; calciumMg: number; carbs: number };
  now: string; // «HH:mm»
  mealsDone: number; // meals recorded today (eaten)
  foods: Map<string, Food>;
  usual: string[]; // food ids this person eats often, the most frequent first
}

const PORTION_CARBS = 40; // one usual side portion — «less than one portion left» (scenario 4)
const SHARE = 0.75; // by evening a day that will not reach its target is short by more than a quarter
const NEED: Record<TopGoal, { per: number; key: 'kcal' | 'protein' | 'calciumMg' }> = { kcal: { per: 120, key: 'kcal' }, proteinG: { per: 10, key: 'protein' }, calciumMg: { per: 120, key: 'calciumMg' } };

const MAX_KCAL = 350;
/** The nutrient a 100 kcal of the food brings — what adds the target without filling the day's energy. */
const density = (f: Food, key: 'kcal' | 'protein' | 'calciumMg') => { const n = itemNutrients(itemFor(f, {}), f); return n.kcal ? (n[key] / n.kcal) * 100 : 0; };
const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
/** Ready in minutes: nothing raw that must be cooked, nothing dry that must be boiled. */
const ready = (f: Food) => !/\((сир|сух)(а|е|і|ий)\)/iu.test(f.name) && !f.tags.includes('condiment') && !f.tags.includes('alcohol');

function evening(s: DayState): boolean {
  const by = s.targets.lastMealBy ?? '20:00';
  return s.mealsDone >= 2 && minutes(s.now) >= minutes('13:00') && minutes(s.now) < minutes(by); // D97: right up to «їжа до», not half an hour before
}

const GOALS: TopGoal[] = ['kcal', 'proteinG', 'calciumMg'];

/** D116: the plan's targets the day is short of by more than a quarter — whatever the hour (for the evening reminder, set
 *  in the morning and taken back by the next record that closes the gap). Only on a day being recorded. */
export function shortGoals(s: Omit<DayState, 'now'>): { goal: TopGoal; have: number; target: number }[] {
  if (s.mealsDone < 1) return []; // nothing recorded today — the app cannot know, it says nothing
  return GOALS.flatMap((goal) => {
    const target = s.targets[goal];
    if (target === undefined) return []; // boundary 7: no target — no advice
    const have = Math.round(s.have[NEED[goal].key]);
    return have < target * SHARE ? [{ goal, have, target }] : [];
  });
}

/** Scenario 3: a target of the plan the day will not reach — and three things that pass the plan to add. */
export function topups(s: DayState, asked = false): Topup[] {
  if (!asked && !evening(s)) return []; // D117: asked in the assistant — any hour of a recorded day
  const out: Topup[] = [];
  for (const { goal, have, target } of shortGoals(s)) {
    const most = goal === 'kcal' ? Math.min(450, target - have + 100) : MAX_KCAL;
    const ok = (f: Food) => {
      if (!ready(f)) return false;
      const it = itemFor(f, {}), n = itemNutrients(it, f);
      if (n[NEED[goal].key] < NEED[goal].per || n.kcal > most) return false; // an addition, not a second dinner
      return checkMeal({ plan: s.plan, date: s.date, foods: s.foods, dayEntries: [], recentEntries: [], meal: [it] }).every((c) => c.hits.length === 0);
    };
    const usual = s.usual.map((id) => s.foods.get(id)).filter((f): f is Food => !!f && ok(f));
    const rest = [...s.foods.values()].filter((f) => !s.usual.includes(f.id) && ok(f))
      .sort((a, b) => goal === 'kcal' ? density(b, 'protein') - density(a, 'protein') : density(b, NEED[goal].key) - density(a, NEED[goal].key)); // calories — the filling ones with protein first
    const items = [...usual, ...rest].slice(0, 3).map((f) => itemFor(f, {}));
    if (items.length) out.push({ kind: 'topup', goal, have, target, gap: target - have, items });
  }
  return out;
}

/** Scenario 4: the carbs limit is less than one usual portion away, and a meal is still ahead. */
export function nearLimit(s: DayState): NearLimit | null {
  const max = s.targets.carbsG?.max;
  if (max === undefined || !evening(s)) return null;
  const have = Math.round(s.have.carbs), left = max - have;
  return left < PORTION_CARBS ? { kind: 'limit', have, max, left } : null;
}
