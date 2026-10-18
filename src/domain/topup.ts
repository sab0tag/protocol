// D92: the concierge, scenarios 3–4 — code only. «Білка 85 з 140 г. Добрати до вечора?» and «Вуглеводів 170 з 190 г — на
// вечерю краще без гарніру»: the numbers are the code's, the candidates pass the whole plan check, are ready in minutes and
// come from what the person usually eats first. Silent without a target in the plan (a doctor may limit protein), without
// a meal recorded at midday, after the last meal of the day, or once answered today. A tap puts it in the evening's plan,
// never in what was eaten.
import { checkMeal } from './rules';
import { itemFor } from './foodSearch';
import { itemNutrients } from './nutrition';
import type { Food, MealItem, Plan, Targets } from './types';

export type TopGoal = 'proteinG' | 'calciumMg';
export interface Topup { kind: 'topup'; goal: TopGoal; have: number; target: number; gap: number; items: MealItem[] }
export interface NearLimit { kind: 'limit'; have: number; max: number; left: number }

export interface DayState {
  plan: Plan; targets: Targets; date: string;
  have: { protein: number; calciumMg: number; carbs: number };
  now: string; // «HH:mm»
  mealsDone: number; // meals recorded today (eaten)
  foods: Map<string, Food>;
  usual: string[]; // food ids this person eats often, the most frequent first
}

const PORTION_CARBS = 40; // one usual side portion — «less than one portion left» (scenario 4)
const SHARE = 0.75; // by evening a day that will not reach its target is short by more than a quarter
const NEED: Record<TopGoal, { per: number; key: 'protein' | 'calciumMg' }> = { proteinG: { per: 10, key: 'protein' }, calciumMg: { per: 120, key: 'calciumMg' } };

const MAX_KCAL = 350;
/** The nutrient a 100 kcal of the food brings — what adds the target without filling the day's energy. */
const density = (f: Food, key: 'protein' | 'calciumMg') => { const n = itemNutrients(itemFor(f, {}), f); return n.kcal ? (n[key] / n.kcal) * 100 : 0; };
const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
/** Ready in minutes: nothing raw that must be cooked, nothing dry that must be boiled. */
const ready = (f: Food) => !/\((сир|сух)(а|е|і|ий)\)/iu.test(f.name) && !f.tags.includes('condiment') && !f.tags.includes('alcohol');

function evening(s: DayState): boolean {
  const by = s.targets.lastMealBy ?? '20:00';
  return s.mealsDone >= 2 && minutes(s.now) >= minutes('13:00') && minutes(s.now) < minutes(by); // D97: right up to «їжа до», not half an hour before
}

/** Scenario 3: a target of the plan the day will not reach — and three things that pass the plan to add. */
export function topups(s: DayState): Topup[] {
  if (!evening(s)) return [];
  const out: Topup[] = [];
  for (const goal of ['proteinG', 'calciumMg'] as TopGoal[]) {
    const target = s.targets[goal];
    if (target === undefined) continue; // boundary 7: no target — no advice
    const have = Math.round(s.have[NEED[goal].key]);
    if (have >= target * SHARE) continue;
    const ok = (f: Food) => {
      if (!ready(f)) return false;
      const it = itemFor(f, {}), n = itemNutrients(it, f);
      if (n[NEED[goal].key] < NEED[goal].per || n.kcal > MAX_KCAL) return false; // an addition, not a second dinner
      return checkMeal({ plan: s.plan, date: s.date, foods: s.foods, dayEntries: [], recentEntries: [], meal: [it] }).every((c) => c.hits.length === 0);
    };
    const usual = s.usual.map((id) => s.foods.get(id)).filter((f): f is Food => !!f && ok(f));
    const rest = [...s.foods.values()].filter((f) => !s.usual.includes(f.id) && ok(f))
      .sort((a, b) => density(b, NEED[goal].key) - density(a, NEED[goal].key));
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
