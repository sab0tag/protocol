// IndexedDB through Dexie (SPEC.md §4). Everything stays on the device.
import Dexie, { type Table } from 'dexie';
import type { ReminderSettings } from '../domain/reminders';
import type { DayEntry, Favorite, Food, Friction, LabResult, Plan, Recipe, WeightLog, Wellbeing, Workout } from '../domain/types';
import { FOODS } from './foods';
import { RECIPES } from './recipes';
import { emptyPlan, examplePlan } from './seed.example';
import { demoData } from './demo';
import { todayISO } from '../domain/dates';

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
  /** D96: the time (inside the sealed record) of the version this device last agreed on — an older one from the server is a rollback */
  at?: number;
}

export interface SyncMeta {
  key: 'sync';
  code: string;
  seq: number; // the last server change pulled
  lastAt?: number;
  photoConsent?: boolean;
  menuConsent?: boolean; // D33
  workoutConsent?: boolean; // D63
  labsConsent?: boolean; // D68: lab values go to Claude only after this
  conclusionConsent?: boolean; // D80: a photo of a doctor's conclusion — the same
  medboxConsent?: boolean; // D89: a photo of a medicine package — the same
  conciergeConsent?: boolean; // D91: the concierge may send a line and the base's names to Claude
  conciergeLog?: boolean; // D91: its calls are logged for the weekly review — a consent of its own, off by default
  device?: string; // D34: this device's id for push
  reminders?: ReminderSettings & { on: boolean };
  snoozed?: Record<string, number>; // D35: «Пізніше» — reminder key → until (ms)
  codeCheckedAt?: number; // D40: «код записаний?» asked again a month later
}

/** D114: the piece of the doctor's paper a line of the plan was read from, as the person cut and painted it — kept on this
 *  device only (not in sync, not in the backup file): `id` is the line's id in the plan (a medicine, a limit), «checkup». */
export interface Piece { id: string; url: string; at: string; source: string }

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
  frictions!: Table<Friction, string>;
  pieces!: Table<Piece, string>;
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
    this.version(5).stores({ frictions: 'id, at' }); // D67: «Що заважало»
    this.version(6).stores({ pieces: 'id' }); // D114: pieces of the doctor's paper — this device only, never synced or exported
  }
}

/** D98: the example lives in a database of its own — «Подивитись приклад» is always there, the person's own data is never
 *  mixed with invented records, and nothing of the example can reach the server (no sync in it). A flag on the device picks
 *  the database at start; leaving the example deletes it and opens the person's own, untouched. */
export const DEMO_DB = 'protocol-demo';
const DEMO_FLAG = 'protocol.demo';
export const inDemo = (): boolean => { try { return localStorage.getItem(DEMO_FLAG) === '1'; } catch { return false; } };
export const db = new ProtocolDB(inDemo() ? DEMO_DB : 'protocol');
export function enterDemo(): void { try { localStorage.setItem(DEMO_FLAG, '1'); } catch { /* private mode — stays */ } location.hash = '#/'; location.reload(); }
export async function leaveDemo(): Promise<void> {
  try { localStorage.removeItem(DEMO_FLAG); } catch { /* private mode */ }
  db.close();
  await Dexie.delete(DEMO_DB).catch(() => undefined);
  location.hash = '#/';
  location.reload();
}

/** D43: a plan missing a part (a sync mishap) still reads as a plan for the screens — never `undefined` lists.
 *  Only for reading: sync sees the stored row as it is, so the defaults are never sent anywhere. */
export function normalizePlan<T extends PlanRow | undefined>(p: T): T {
  return (p && { ...p, constraints: p.constraints ?? [], prescriptions: p.prescriptions ?? [], targets: p.targets ?? {}, modes: p.modes ?? [] }) as T;
}

/** Base food ids removed from foods.ts; meals keep their own copy of the line, so nothing recorded changes. */
const REMOVED_BASE = ['kompot'];

/** Every start: the built-in food base; first start: a plan (the personal seed.local.ts if present, else an empty one —
 *  the example only when the person asks for it, D73). */
export async function ensureSeeded(target: ProtocolDB = db): Promise<void> {
  await target.transaction('rw', target.plan, target.foods, target.recipes, async () => {
    await target.foods.bulkPut(FOODS); // the built-in base is refreshed on every start (new foods, units — D26)
    await target.foods.bulkDelete(REMOVED_BASE); // D83: base rows taken out of foods.ts (a twin «Компот») — never a person's own
    await target.recipes.bulkPut(RECIPES); // built-in dishes too; the user's own have other ids (D27)
    if (!(await target.plan.get('main'))) {
      const local = import.meta.glob<{ localPlan?: () => Plan }>('./seed.local.ts', { eager: true });
      const today = todayISO();
      const plan = target.name === DEMO_DB ? { ...examplePlan(), onboardedAt: today } : Object.values(local)[0]?.localPlan?.() ?? emptyPlan();
      await target.plan.put({ id: 'main', ...plan });
    }
  });
  // D98: the example database gets its two invented weeks once
  if (target.name === DEMO_DB && (await target.entries.count()) === 0) {
    const d = demoData(new Map((await target.foods.toArray()).map((f) => [f.id, f])));
    await target.transaction('rw', [target.entries, target.workouts, target.weights, target.wellbeing, target.labs], async () => {
      await target.entries.bulkPut(d.entries); await target.workouts.bulkPut(d.workouts); await target.weights.bulkPut(d.weights);
      await target.wellbeing.bulkPut(d.wellbeing); await target.labs.bulkPut(d.labs);
    });
  }
}

/** Ask the browser not to evict our data (Safari may clear storage of sites unused for 7 days). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
