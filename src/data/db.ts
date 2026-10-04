// IndexedDB through Dexie (SPEC.md §4). Everything stays on the device.
import Dexie, { type Table } from 'dexie';
import type { DayEntry, Food, LabResult, Plan, Recipe, WeightLog, Wellbeing, Workout } from '../domain/types';
import { FOODS } from './foods';
import { RECIPES } from './recipes';
import { examplePlan } from './seed.example';

export interface PlanRow extends Plan {
  id: 'main';
}

export class ProtocolDB extends Dexie {
  plan!: Table<PlanRow, string>;
  foods!: Table<Food, string>;
  entries!: Table<DayEntry, string>;
  wellbeing!: Table<Wellbeing, string>;
  workouts!: Table<Workout, string>;
  weights!: Table<WeightLog, string>;
  labs!: Table<LabResult, [string, string]>;
  recipes!: Table<Recipe, string>;

  constructor(name = 'protocol') {
    super(name);
    this.version(1).stores({
      plan: 'id',
      foods: 'id, name',
      entries: 'id, at, kind',
      wellbeing: 'date',
      workouts: 'id, date',
      weights: 'date',
      labs: '[date+name], name',
    });
    this.version(2).stores({ recipes: 'id, name' }); // D27: dishes
  }
}

export const db = new ProtocolDB();

/** Every start: the built-in food base; first start: a plan (the personal seed.local.ts if present, else the example). */
export async function ensureSeeded(target: ProtocolDB = db): Promise<void> {
  await target.transaction('rw', target.plan, target.foods, target.recipes, async () => {
    await target.foods.bulkPut(FOODS); // the built-in base is refreshed on every start (new foods, units — D26)
    await target.recipes.bulkPut(RECIPES); // built-in dishes too; the user's own have other ids (D27)
    if (!(await target.plan.get('main'))) {
      const local = import.meta.glob<{ localPlan?: () => Plan }>('./seed.local.ts', { eager: true });
      const plan = Object.values(local)[0]?.localPlan?.() ?? examplePlan();
      await target.plan.put({ id: 'main', ...plan });
    }
  });
}

/** Ask the browser not to evict our data (Safari may clear storage of sites unused for 7 days). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
