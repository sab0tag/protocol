// D79: two invented weeks for the example plan — so «Прогрес», «Тиждень» and «Звіт для лікаря» show what the records
// are for: a weight line, the doses taken (and three missed), «Здуття» after milk at breakfast, worse sleep after late
// dinners, a few workouts, two lab tests. Every row carries `demo: true` and leaves with the example plan. Pure.
import { addDays, format } from 'date-fns';
import { atLocal } from '../domain/dates';
import { itemFor, parseQuery } from '../domain/foodSearch';
import type { DayEntry, Food, LabResult, MealItem, WeightLog, Wellbeing, Workout, WorkoutExercise } from '../domain/types';
import { EXERCISES } from './exercises';

export interface DemoData { entries: DayEntry[]; workouts: Workout[]; weights: WeightLog[]; wellbeing: Wellbeing[]; labs: LabResult[] }

export const DEMO_DAYS = 14;
const MILK = [12, 9, 5, 2]; // breakfast on milk → «Здуття» two hours later
const LATE = [13, 11, 9, 6, 4, 1]; // dinner at 21:30 → the next night sleeps worse
const NO_VITD = [10, 6, 3];
const GYM = [13, 11, 8, 6, 4, 1];
const WEIGHT: [number, number][] = [[14, 97.6], [11, 97.3], [8, 97.1], [5, 96.9], [2, 96.7]];

export function demoData(foods: Map<string, Food>, today: Date = new Date()): DemoData {
  const day = (k: number) => format(addDays(today, -k), 'yyyy-MM-dd');
  const line = (id: string, said: string): MealItem => itemFor(foods.get(id)!, parseQuery(said));
  const entries: DayEntry[] = [], workouts: Workout[] = [], wellbeing: Wellbeing[] = [];
  const meal = (k: number, time: string, title: string, items: MealItem[]) =>
    entries.push({ id: `demo-${k}-${title}`, at: atLocal(day(k), time), kind: 'meal', status: 'done', title, items, demo: true });

  for (let k = DEMO_DAYS; k >= 1; k--) {
    const d = day(k);
    meal(k, '08:15', 'Сніданок', MILK.includes(k) ? [line('oatmeal-milk', '250 г')]
      : [line('egg-boiled', '3'), line('bread-wholegrain', '1 скибка'), line('tomato', '100 г')]);
    if (MILK.includes(k)) entries.push({ id: `demo-${k}-symptom`, at: atLocal(d, '10:20'), kind: 'symptom', status: 'done',
      title: 'Здуття', symptoms: ['Здуття'], severity: 2, demo: true });
    if (!NO_VITD.includes(k)) entries.push({ id: `demo-${k}-vitd`, at: atLocal(d, '08:35'), kind: 'med', status: 'done',
      title: 'Вітамін D', prescriptionId: 'p-vitd', checkKey: 'med:p-vitd:08:30', demo: true });
    meal(k, '13:00', 'Обід', [line('buckwheat-boiled', '200 г'), line('chicken-breast-cooked', '200 г'), line('cucumber', '100 г')]);
    meal(k, LATE.includes(k) ? '21:30' : '19:00', 'Вечеря', [line('hake-baked', '250 г'), line('brown-rice-boiled', '150 г'), line('broccoli', '100 г')]);
    if (!LATE.includes(k)) entries.push({ id: `demo-${k}-dinner`, at: atLocal(d, '19:20'), kind: 'note', status: 'done', title: 'Вечеря до 20:00',
      checkKey: 'dinner', demo: true });
    for (const [i, time] of ['09:00', '10:00', '11:00', '12:30', '13:30', '15:00', '16:30', ...(k % 3 ? ['17:30', '19:30', '20:30'] : [])].entries()) // 2,5 л on most days
      entries.push({ id: `demo-${k}-water-${i}`, at: atLocal(d, time), kind: 'water', status: 'done', title: 'Вода', waterMl: 250, demo: true });
    if (GYM.includes(k)) {
      const n = GYM.indexOf(k); // later sessions — a rep more
      const exercises = (['goblet-squat', 'kb-deadlift', 'row', 'plank'] as const).map((id): WorkoutExercise => {
        const e = EXERCISES.find((x) => x.id === id)!;
        const sets = Array.from({ length: 3 }, () => (e.timed ? [{ seconds: 30 + n * 5 }]
          : e.unilateral ? [{ side: 'R' as const, reps: 8 + Math.floor(n / 2) }, { side: 'L' as const, reps: 8 + Math.floor(n / 2) }]
            : [{ reps: 8 + n }])).flat();
        return { exerciseId: id, name: e.name, target: e.target, sets };
      });
      workouts.push({ id: `demo-w-${k}`, date: d, durationMin: 35, equipment: 'Гиря 16 кг', exercises, feeling: n < 2 ? 'Важко' : 'Нормально', demo: true });
      entries.push({ id: `demo-${k}-workout`, at: atLocal(d, '18:00'), kind: 'workout', status: 'done', title: 'Тренування',
        workoutId: `demo-w-${k}`, checkKey: 'workout', demo: true });
    }
  }
  for (let k = DEMO_DAYS - 1; k >= 0; k--) {
    const sleep = LATE.includes(k + 1) ? 2 : 4;
    // D81: energy does not follow the late dinner — the example's one clear lesson is the sleep after it
    wellbeing.push({ date: day(k), sleep, ...(k > 0 ? { energy: k % 3 === 0 ? 3 : 4, mood: 4 } : {}),
      symptoms: [], demo: true } as Wellbeing); // «Здуття» is in the entries, with its time
  }
  return {
    entries, workouts, wellbeing,
    weights: WEIGHT.map(([k, kg]) => ({ date: day(k), kg, demo: true })),
    labs: [
      { date: day(40), name: 'Глюкоза натще', value: 6.1, unit: 'ммоль/л', target: '< 5,6', demo: true },
      { date: day(5), name: 'Глюкоза натще', value: 5.7, unit: 'ммоль/л', target: '< 5,6', demo: true },
      { date: day(40), name: 'Феритин', value: 410, unit: 'нг/мл', demo: true },
      { date: day(5), name: 'Феритин', value: 365, unit: 'нг/мл', demo: true },
    ],
  };
}
