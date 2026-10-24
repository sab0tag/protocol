// D117: the assistant's chat — what the code does around the model. The day's numbers and the plan's rules go to it
// ready-made; «що добрати?» is answered by the code alone (scenario 3, D92/D116); a question on medicines, symptoms or
// changing the plan gets the app's own words (boundaries 2–4, 1); a food the model names becomes a meal line only through the
// base and the plan's check — what does not pass is not shown (it goes to the log as a finding). Pure.
import { passes } from './evaluate';
import { itemFor } from './foodSearch';
import { lineNutrients, type DayTotals } from './nutrition';
import type { DayEntry, Food, MealItem, Plan, Recipe, Targets } from './types';

/** «Що добрати до вечора?», «чим добрати білок», «що ще з'їсти» — a short question the code answers by itself. */
const ASKS = /добрат|недобира|не\s+вистача|чим\s+добрати|що\s+(?:б\s+)?(?:ще\s+)?(?:з[’'ʼ]?їсти|поїсти|перекусити)/iu;
export const asksTopup = (text: string) => ASKS.test(text) && text.trim().split(/\s+/).length <= 7 && !/лише|тільки|є\s+вдома|вдома/iu.test(text);

const r = (n: number) => Math.round(n);

/** What the model is told — the code's numbers and the plan's words; no name, no diagnosis, no medicine. */
export function dayContext(plan: Plan, targets: Targets, totals: DayTotals, now: string, usual: string[]) {
  const t: Record<string, number | string> = {};
  for (const [k, v] of Object.entries({ kcal: targets.kcal, proteinG: targets.proteinG, calciumMg: targets.calciumMg, fatG: targets.fatG,
    carbsMinG: targets.carbsG?.min, carbsMaxG: targets.carbsG?.max, waterMl: targets.waterMl, lastMealBy: targets.lastMealBy })) if (v !== undefined) t[k] = v;
  return {
    now, targets: t,
    day: { kcal: r(totals.kcal), proteinG: r(totals.protein), fatG: r(totals.fat), carbsG: r(totals.carbs), calciumMg: r(totals.calciumMg), waterMl: r(totals.waterMl) },
    rules: plan.constraints.filter((c) => c.active).map((c) => [c.title, c.reason].filter(Boolean).join(': ')),
    usual: usual.slice(0, 15),
  };
}

export type Topic = 'food' | 'medicine' | 'symptoms' | 'plan' | 'other';

/** Boundaries 1–4: these are answered by the app's own words, never by the model's. */
export function fixedAnswer(topic: Topic, plan: Plan): string | undefined {
  if (topic === 'medicine') {
    const meds = plan.prescriptions.filter((p) => (p.kind === 'medication' || p.kind === 'supplement'))
      .map((p) => [p.title, p.dose, p.asNeeded ? 'за потреби' : p.schedule?.times.join(', '), p.schedule?.withFood === true ? 'під час їжі' : p.schedule?.withFood === false ? 'натщесерце' : '']
        .filter(Boolean).join(' '));
    return `Про ліки — дозу, пропуск, поєднання з їжею чи іншими ліками — запитайте лікаря або фармацевта.${meds.length ? ` У вашому плані: ${meds.join('; ')}.` : ''}`;
  }
  if (topic === 'symptoms') return 'Що означають самопочуття, симптоми чи аналізи, скаже лікар — запишіть, і це буде у звіті для нього. Якщо стан різко погіршився — телефонуйте 103.';
  if (topic === 'plan') return 'Цілі, обмеження, дієту й дози змінює лікар. Можу допомогти виконати план, як він є: підказати, що з’їсти.';
  return undefined;
}

/** A name the model gave → a meal line of the base, with its grams; dishes by their portion's weight. */
export function lineOf(name: string, grams: number, foods: Food[], recipes: Recipe[], dishItem: (r: Recipe, portions: number) => MealItem): MealItem | undefined {
  const f = foods.find((x) => x.name === name);
  if (f) { const it = itemFor(f, {}); return it.unit ? { ...it, grams, unit: { ...it.unit, qty: Math.round((grams / it.unit.grams) * 2) / 2 || 1, grams: it.unit.grams } } : { ...it, grams }; }
  const d = recipes.find((x) => x.name === name);
  if (!d) return undefined;
  const one = dishItem(d, 1).grams;
  return dishItem(d, one > 0 ? Math.max(0.5, Math.round((grams / one) * 2) / 2) : 1);
}

/** Only what passes the whole plan check is shown (the rest is a finding for the log, never a suggestion). */
/** R04: the model's words without the foods the check took out — a sentence naming one is dropped (by the words of its name that
 *  no food still shown has), so the text never recommends what the cards do not show. */
export function withoutDropped(text: string, dropped: string[], shown: string[]): string {
  if (!dropped.length) return text;
  const words = (s: string) => s.toLocaleLowerCase('uk').split(/[^\p{L}’']+/u).filter((w) => w.length >= 4);
  const keep = new Set(shown.flatMap(words).map((w) => w.slice(0, 5)));
  const stems = [...new Set(dropped.flatMap(words).map((w) => w.slice(0, 5)))].filter((s) => !keep.has(s));
  return text.split(/(?<=[.!?…])\s+/u).filter((x) => !stems.some((s) => words(x).some((w) => w.startsWith(s)))).join(' ');
}

/** R03: each food the model named, checked against the plan in the real day (`entries` — the day and the week before). */
export function passing(items: MealItem[], plan: Plan, date: string, foods: Map<string, Food>, entries: DayEntry[] = []): { shown: MealItem[]; dropped: string[] } {
  const shown: MealItem[] = [], dropped: string[] = [];
  for (const it of items) {
    if (!passes({ plan, date, foods, entries }, it)) dropped.push(it.name);
    else shown.push(it);
  }
  return { shown, dropped };
}

/** The numbers of a suggestion — the code's: what it brings, and where the day would be after it. */
export function brings(item: MealItem, foods: Map<string, Food>) {
  const n = lineNutrients(item, foods); // a dish — its ingredients
  return { kcal: r(n.kcal), protein: r(n.protein), calciumMg: r(n.calciumMg), carbs: r(n.carbs) };
}
