// An anonymised example plan (SPEC.md §9.3). Real data goes to seed.local.ts (git-ignored), same shape.
import { addDays, format } from 'date-fns';
import type { Plan } from '../domain/types';

export function examplePlan(today: Date = new Date()): Plan {
  const d = (n: number) => format(addDays(today, n), 'yyyy-MM-dd');
  return {
    constraints: [
      { id: 'c-oxalate', tag: 'oxalate', title: 'Оксалатні камені', reason: 'Без шпинату й буряка. Кальцій — у той самий прийом.', source: 'Приклад', active: true },
      { id: 'c-gallbladder', tag: 'gallbladder', title: 'Жовчний міхур', reason: 'Без смаженого, вага знижується повільно.', source: 'Приклад', active: true },
      { id: 'c-lactose', tag: 'lactose', title: 'Непереносимість лактози', reason: 'Кефір і витримані сири — так, молоко — ні.', source: 'Приклад', active: true },
      { id: 'c-glycemic', tag: 'glycemic', title: 'Порушена глікемія', reason: 'Повільні вуглеводи замість швидких.', source: 'Приклад', active: true },
      { id: 'c-iron', tag: 'iron', title: 'Високий феритин', reason: 'Печінка — не частіше разу на тиждень.', source: 'Приклад', active: true },
    ],
    prescriptions: [
      { id: 'p-vitd', kind: 'supplement', title: 'Вітамін D', dose: '2000 МО', schedule: { times: ['08:30'], withFood: true }, source: 'Приклад', since: d(-30) },
    ],
    targets: {
      kcal: 2100, proteinG: 140, carbsG: { max: 190 }, fatG: 80, calciumMg: 1000, waterMl: 2500,
      lastMealBy: '20:00', weightGoalKg: 90, maxWeightLossKgPerWeek: 0.5,
    },
    modes: [
      {
        id: 'm-ogtt', title: 'Підготовка до ОГТТ', from: d(3), to: d(5),
        targetsOverride: { carbsG: { min: 150 }, lastMealBy: '20:00' },
        notes: ['Не менше 150 г вуглеводів на день', 'Натщесерце, без кави й тренування в день тесту'],
      },
    ],
  };
}

// D73: the example is opened on purpose («Подивитись на прикладі») and shown as one: a plan with its items says so on
// «День» and «План», and «Почати свій план» takes out exactly what came from the example — nothing the person added.
export const EXAMPLE_SOURCE = 'Приклад';
const EXAMPLE_MODE = 'm-ogtt';

export const emptyPlan = (): Plan => ({ constraints: [], prescriptions: [], targets: {}, modes: [] });

export function hasExample(plan: Pick<Plan, 'constraints' | 'prescriptions' | 'modes'>): boolean {
  return plan.constraints.some((c) => c.source === EXAMPLE_SOURCE) || plan.prescriptions.some((p) => p.source === EXAMPLE_SOURCE)
    || plan.modes.some((m) => m.id === EXAMPLE_MODE);
}

/** The plan without the example's items; the targets go too when they are still exactly the example's. */
export function withoutExample(plan: Plan): Pick<Plan, 'constraints' | 'prescriptions' | 'targets' | 'modes'> {
  const same = JSON.stringify(sorted(plan.targets)) === JSON.stringify(sorted(examplePlan().targets));
  return {
    constraints: plan.constraints.filter((c) => c.source !== EXAMPLE_SOURCE),
    prescriptions: plan.prescriptions.filter((p) => p.source !== EXAMPLE_SOURCE),
    targets: same ? {} : plan.targets,
    modes: plan.modes.filter((m) => m.id !== EXAMPLE_MODE),
  };
}

const sorted = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)));
