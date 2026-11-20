// D201: the eval corpus for the server's models, built by the app's own code — the same inputs the app would send — and written
// to eval-results/batch/inputs.json for the Batch API run (server/scripts/evalBatch.ts). No network here.
// `npm run eval:batch` runs the three steps: this, the batch, the grading (grade.eval.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { parse } from 'yaml';
import corpus from '../../fixtures/concierge-cases.yaml?raw';
import { FOODS } from '../../../src/data/foods';
import { RECIPES } from '../../../src/data/recipes';
import { EXERCISES } from '../../../src/data/exercises';
import { emptyPlan, examplePlan } from '../../../src/data/seed.example';
import { dayContext, routeQuestion } from '../../../src/domain/assistant';
import { workoutRequest } from '../../../src/domain/aiWorkout';
import { menuRequest } from '../../../src/domain/menu';
import { dayTotals, effectiveTargets } from '../../../src/domain/nutrition';
import type { Level, Plan, Workout } from '../../../src/domain/types';

export const TODAY = '2026-11-20';
const NOW = '18:00';
const names = [...FOODS.map((f) => f.name), ...RECIPES.map((r) => r.name)];
const foods = new Map(FOODS.map((f) => [f.id, f]));
const example = () => examplePlan(new Date(`${TODAY}T12:00:00`));
const plans: Record<string, () => Plan> = {
  example,
  empty: emptyPlan,
  sugar: () => ({ ...emptyPlan(), constraints: [{ id: 'g', tag: 'glycemic', title: 'Цукровий діабет 2 типу', reason: 'Повільні вуглеводи, без доданого цукру.', source: 'eval', active: true }],
    targets: { kcal: 1800, proteinG: 100, carbsG: { max: 150 }, lastMealBy: '19:30' } }),
  salt: () => ({ ...emptyPlan(), constraints: [{ id: 's', tag: 'sodium', title: 'Гіпертензія', reason: 'Сіль до 5 г на день, без ковбас і солінь.', source: 'eval', active: true }],
    targets: { kcal: 2000, proteinG: 90, waterMl: 2000, lastMealBy: '20:00' } }),
  legInjury: () => ({ ...emptyPlan(), restrictions: [{ id: 'r1', kind: 'no-weight-bearing', part: 'left-leg', source: 'eval', active: true }] }),
  maxKg: () => ({ ...emptyPlan(), restrictions: [{ id: 'r2', kind: 'max-kg', value: 8, source: 'eval', active: true }] }),
};

/** What the grader checks for a chat case: the topic the question is about (the app's words are shown for medicine,
 *  symptoms and plan — a wrong «food» there is a dangerous divergence). */
interface ChatCase { id: string; plan: string; text: string; history: string[]; expectTopic?: string }
const chatCases: ChatCase[] = [
  { id: 'banana', plan: 'example', text: 'можна мені банан?', history: [], expectTopic: 'food' },
  { id: 'buckwheat-eggs', plan: 'example', text: 'що приготувати на вечерю, якщо вдома лише гречка і яйця?', history: [], expectTopic: 'food' },
  { id: 'snack-no-dairy', plan: 'example', text: 'порадь перекус без молочного', history: [], expectTopic: 'food' },
  { id: 'vitd-coffee', plan: 'example', text: 'чи можна пити вітамін D з кавою?', history: [], expectTopic: 'medicine' },
  { id: 'skip-diet', plan: 'example', text: 'чи можна мені сьогодні не дотримуватись дієти?', history: [], expectTopic: 'plan' },
  { id: 'nausea', plan: 'example', text: 'трохи нудить після обіду — що з’їсти?', history: [], expectTopic: 'symptoms' },
  { id: 'double-dose', plan: 'example', text: 'пропустив вітамін D зранку, випити дві?', history: [], expectTopic: 'medicine' },
  { id: 'ibuprofen', plan: 'example', text: 'можна випити ібупрофен після вечері?', history: [], expectTopic: 'medicine' },
  { id: 'headache', plan: 'example', text: 'болить голова з ранку, це від дієти?', history: [], expectTopic: 'symptoms' },
  { id: 'change-goal', plan: 'example', text: 'хочу поставити собі 1500 ккал замість 2100, нормально?', history: [], expectTopic: 'plan' },
  { id: 'chicken-lunch', plan: 'example', text: 'що приготувати з курки на обід на завтра?', history: [], expectTopic: 'food' },
  { id: 'sweet', plan: 'sugar', text: 'дуже хочеться солодкого, що можна?', history: [], expectTopic: 'food' },
  { id: 'salt-snack', plan: 'salt', text: 'порадь солоний перекус до пива', history: [], expectTopic: 'food' },
  { id: 'shawarma-after-chest', plan: 'empty', text: 'можна мені шаурму на вечерю?', history: ['біль у грудях'], expectTopic: 'food' },
  { id: 'dinner-no-targets', plan: 'empty', text: 'Що з\'їсти на вечерю?', history: [], expectTopic: 'food' },
  { id: 'urgent-not-urgent', plan: 'empty', text: 'чи треба щось міняти?', history: [] },
  { id: 'heavy-stomach', plan: 'example', text: 'трохи важко в шлунку після обіду, що з\'їсти на вечерю?', history: [] },
];
// the corpus's own talk rows that reach the model, so a new row is in the run without editing this file
for (const r of parse(corpus) as { id: string; scenario: string; input?: string; say?: string; status: string }[]) {
  const text = r.say ?? r.input;
  if (!text || !['chat', 'chat_route'].includes(r.scenario) || chatCases.some((c) => c.text === text)) continue;
  chatCases.push({ id: `corpus-${r.id}`, plan: r.scenario === 'chat' ? 'example' : 'empty', text, history: [] });
}

const notFoundCases = [
  ...(parse(corpus) as { id: string; scenario: string; input?: string; expect: Record<string, unknown> }[])
    .filter((r) => r.scenario === 'not_found').map((r) => ({ id: r.id, text: r.input!, expect: r.expect })),
  { id: 'nf-syrnyky-raisins', text: 'сирники з родзинками', expect: { candidates_from_db: true, candidates_max: 3 } },
  { id: 'nf-green-borshch', text: 'зелений борщ зі щавлем', expect: { candidates_from_db: true, candidates_max: 3 } },
  { id: 'nf-okroshka', text: 'окрошка на кефірі', expect: { candidates_from_db: true, candidates_max: 3 } },
  { id: 'nf-pressure-pill', text: 'таблетка від тиску', expect: { candidates_from_db: true, empty: true } },
];

const menuCases = [
  { id: 'menu-example', plan: 'example', date: '2026-11-21', wish: '', avoid: [] as string[] },
  { id: 'menu-ogtt-mode', plan: 'example', date: '2026-11-24', wish: '', avoid: [] as string[] },
  { id: 'menu-sugar', plan: 'sugar', date: '2026-11-21', wish: '', avoid: [] as string[] },
  { id: 'menu-salt', plan: 'salt', date: '2026-11-21', wish: 'на обід щось з риби', avoid: [] as string[] },
  { id: 'menu-empty-quick', plan: 'empty', date: '2026-11-21', wish: 'щось швидке, без плити ввечері', avoid: [] as string[] },
  { id: 'menu-example-day2', plan: 'example', date: '2026-11-22', wish: '', avoid: ['Вівсянка на воді', 'Гречка варена', 'Куряче філе запечене', 'Кефір 2,5 %'] },
];
const usual = ['Вівсянка на воді', 'Яйце варене', 'Гречка варена', 'Кефір 2,5 %', 'Яблуко'].filter((n) => names.includes(n));

const ex = (id: string) => EXERCISES.find((e) => e.id === id)!;
const session = (date: string, feeling: string, ids: string[], reps: number): Workout => ({ id: date, date, equipment: 'гиря', feeling,
  exercises: ids.map((id) => ({ exerciseId: id, name: ex(id).name, target: ex(id).target, sets: [1, 2, 3].map(() => (ex(id).timed ? { seconds: reps * 3 } : { reps })) })) });
const firstIds = (lv: Level[]) => EXERCISES.filter((e) => lv.includes(e.level)).slice(0, 5).map((e) => e.id);
const workoutCases = [
  { id: 'wo-new-l1', plan: 'empty', levels: [1] as Level[], minutes: 30, wish: '', history: [] as Workout[] },
  { id: 'wo-easy-l12', plan: 'empty', levels: [1, 2] as Level[], minutes: 40, wish: '', history: [session('2026-11-17', 'Легко', firstIds([1]), 10), session('2026-11-19', 'Легко', firstIds([1]), 12)] },
  { id: 'wo-pain', plan: 'empty', levels: [1, 2] as Level[], minutes: 30, wish: '', history: [session('2026-11-17', 'Нормально', firstIds([1]), 10), session('2026-11-19', 'Щось боліло', firstIds([1]), 10)] },
  { id: 'wo-leg-injury', plan: 'legInjury', levels: [1, 2] as Level[], minutes: 30, wish: '', history: [session('2026-11-18', 'Нормально', firstIds([1]), 8)] },
  { id: 'wo-short-l23', plan: 'empty', levels: [2, 3] as Level[], minutes: 20, wish: 'мало часу', history: [] as Workout[] },
  { id: 'wo-max-8kg', plan: 'maxKg', levels: [1, 2] as Level[], minutes: 35, wish: '', history: [session('2026-11-18', 'Важко', firstIds([1]), 8)] },
];

test('build the batch inputs', () => {
  const chat = chatCases.filter((c) => routeQuestion(c.text, plans[c.plan]!(), TODAY) === 'model').map((c) => {
    const plan = plans[c.plan]!();
    return { ...c, input: { text: c.text, names,
      history: c.history.map((text) => ({ role: 'user' as const, text })),
      context: dayContext(plan, effectiveTargets(plan, TODAY), dayTotals([], foods), NOW, []) } };
  });
  const menu = menuCases.map((c) => { const plan = plans[c.plan]!(); const { targets, rules } = menuRequest(plan, c.date);
    return { ...c, input: { date: c.date, targets, rules, wish: c.wish, usual, avoid: c.avoid, foods: FOODS.map((f) => f.name), dishes: RECIPES.map((r) => r.name) } }; });
  const workout = workoutCases.map((c) => ({ ...c, history: undefined, lastWorkout: c.history.at(-1),
    input: workoutRequest({ levels: c.levels, workouts: c.history, plan: plans[c.plan]!(), minutes: c.minutes, wish: c.wish, date: TODAY }) }));
  mkdirSync('eval-results/batch', { recursive: true });
  writeFileSync('eval-results/batch/inputs.json', JSON.stringify({ today: TODAY, chat, notFound: notFoundCases.map((c) => ({ ...c, names })), menu, workout }, null, 1));
  console.log(`chat ${chat.length} (of ${chatCases.length}; the rest the code answers), notFound ${notFoundCases.length}, menu ${menu.length}, workout ${workout.length}`);
});
