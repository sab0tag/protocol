// IndexedDB through Dexie (SPEC.md §4). Everything stays on the device.
import Dexie, { type Table } from 'dexie';
import type { ReminderSettings } from '../domain/reminders';
import type { DayEntry, Favorite, Food, LabResult, Plan, Recipe, WeightLog, Wellbeing, Workout } from '../domain/types';
import { FOODS } from './foods';
import { RECIPES } from './recipes';
import { examplePlan } from './seed.example';

export interface PlanRow extends Plan {
  id: 'main';
}

/** D31: the last state of a row both this device and the vault agree on (`h`), and a local change not yet sent
 *  (`dh` — its hash, `dat` — when it was first seen). `tid` = "table:id". */
export interface SyncRow {
  tid: string;
  k: string; // the record's name on the server
  h?: string; // agreed hash; "-" = deleted; absent = never synced
  dh?: string;
  dat?: number;
}

export interface SyncMeta {
  key: 'sync';
  code: string;
  seq: number; // the last server change pulled
  lastAt?: number;
  photoConsent?: boolean;
  menuConsent?: boolean; // D33
  workoutConsent?: boolean; // D63
  device?: string; // D34: this device's id for push
  reminders?: ReminderSettings & { on: boolean };
  snoozed?: Record<string, number>; // D35: «Пізніше» — reminder key → until (ms)
  codeCheckedAt?: number; // D40: «код записаний?» asked again a month later
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
  favorites!: Table<Favorite, string>;
  sync!: Table<SyncRow, string>;
  meta!: Table<SyncMeta, string>;

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
    this.version(3).stores({ sync: 'tid', meta: 'key' }); // D31: sync state (not in exports)
    this.version(4).stores({ favorites: 'id, title' }); // D51: «Мої звичні»
  }
}

export const db = new ProtocolDB();

/** D43: a plan missing a part (a sync mishap) still reads as a plan for the screens — never `undefined` lists.
 *  Only for reading: sync sees the stored row as it is, so the defaults are never sent anywhere. */
export function normalizePlan<T extends PlanRow | undefined>(p: T): T {
  return (p && { ...p, constraints: p.constraints ?? [], prescriptions: p.prescriptions ?? [], targets: p.targets ?? {}, modes: p.modes ?? [] }) as T;
}

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
