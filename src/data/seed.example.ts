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
      { id: 'p-vitd', kind: 'supplement', title: 'Вітамін D', schedule: { times: ['08:30'], withFood: true }, source: 'Приклад' },
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
