// Export / import of all data as JSON (SPEC.md §5.8, §8) — the only backup in v0.
import type { DayEntry, Favorite, Food, Friction, LabResult, Recipe, WeightLog, Wellbeing, Workout } from '../domain/types';
import { db, type PlanRow, type ProtocolDB } from './db';
import { validateModuleEvents, type ModuleEvent } from '../domain/modulePreferences';
import { appendModuleEvents, initialiseModulePreferences } from './modulePreferences';
import { databasePersonId, rebindSourcePlanBackup, sourcePlanBackup, validateSourcePlanBackup, type SourcePlanBackup } from './planBackup';

export const FORMAT = 'protocol-export';
export const VERSION = 3; // D134: old apps must not silently restore a file whose preferences they cannot preserve

export interface ExportFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  plan: PlanRow;
  foods: Food[];
  entries: DayEntry[];
  wellbeing: Wellbeing[];
  workouts: Workout[];
  weights: WeightLog[];
  labs: LabResult[];
  recipes?: Recipe[]; // D27 (files from before dishes have none)
  favorites?: Favorite[]; // D51
  frictions?: Friction[]; // D67
  sourcePlans?: SourcePlanBackup; // v3 only; one-person normalized data and recovery snapshot
  moduleEvents?: ModuleEvent[]; // D134: required in v2; absent in legacy v1 files
}

export async function exportAll(target: ProtocolDB = db, now = new Date()): Promise<ExportFile> {
  return target.transaction('r', [target.plan, target.foods, target.entries, target.wellbeing, target.workouts, target.weights, target.labs, target.recipes, target.favorites, target.frictions, target.moduleEvents, target.carePlans, target.carePlanItems, target.planMigrations], async () => {
    const plan = await target.plan.get('main');
    if (!plan) throw new Error('Немає плану — нічого зберігати.');
    const sourcePlans = await sourcePlanBackup(target);
    return {
      format: FORMAT, version: sourcePlans ? VERSION : 2, exportedAt: now.toISOString(), plan,
      foods: await target.foods.toArray(), entries: await target.entries.toArray(), wellbeing: await target.wellbeing.toArray(),
      workouts: await target.workouts.toArray(), weights: await target.weights.toArray(), labs: await target.labs.toArray(),
      recipes: await target.recipes.toArray(), favorites: await target.favorites.toArray(), frictions: await target.frictions.toArray(),
      moduleEvents: await target.moduleEvents.orderBy('at').toArray(), ...(sourcePlans ? { sourcePlans } : {}),
    };
  });
}

/** Checks the file before anything is touched. Diary data is replaced atomically; preference histories are merged. */
export function parseExport(text: string): ExportFile {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('Це не файл копії: не вдалося прочитати JSON.'); }
  const d = data as Partial<ExportFile>;
  if (d.format !== FORMAT) throw new Error('Це не файл копії «Протоколу».');
  if (typeof d.version !== 'number' || d.version > VERSION) throw new Error('Файл з новішої версії застосунку — оновіть застосунок.');
  if (!Number.isInteger(d.version) || d.version < 1) throw new Error('Невірна версія файлу копії.');
  if (!d.plan || d.plan.id !== 'main') throw new Error('У файлі немає плану.');
  for (const k of ['foods', 'entries', 'wellbeing', 'workouts', 'weights', 'labs'] as const) {
    if (!Array.isArray(d[k])) throw new Error(`У файлі пошкоджено розділ «${k}».`);
  }
  for (const k of ['recipes', 'favorites', 'frictions'] as const) {
    if (d[k] !== undefined && !Array.isArray(d[k])) throw new Error(`У файлі пошкоджено розділ «${k}».`);
  }
  if (d.version >= 2) validateModuleEvents(d.moduleEvents);
  else if (d.moduleEvents !== undefined) throw new Error('Історія налаштувань розділів потребує формату копії 2.');
  if (d.version === 3) validateSourcePlanBackup(d.sourcePlans);
  else if (d.sourcePlans !== undefined) throw new Error('Окремі плани потребують формату копії 3.');
  return d as ExportFile;
}

export async function importAll(file: ExportFile, target: ProtocolDB = db): Promise<void> {
  // Validate direct callers too, before changing any record.
  const checked = parseExport(JSON.stringify(file));
  file = checked;
  const events = checked.version >= 2 ? validateModuleEvents(checked.moduleEvents) : [];
  const sourcePlans = checked.sourcePlans ? rebindSourcePlanBackup(checked.sourcePlans, databasePersonId(target)) : undefined;
  await target.transaction('rw', [target.plan, target.foods, target.entries, target.wellbeing, target.workouts, target.weights, target.labs, target.recipes, target.favorites, target.frictions, target.moduleEvents, target.carePlans, target.carePlanItems, target.planMigrations], async () => {
    // Preferences are an immutable history, not a replacement snapshot: an older copy must not undo a newer off.
    // Colliding ids fail inside the same transaction, before any diary data can be lost.
    if (!sourcePlans && (await target.carePlans.count() || await target.carePlanItems.count() || await target.planMigrations.count()))
      throw new Error('Ця копія не містить окремих планів. Збережіть повну копію перед відновленням старого формату.');
    await appendModuleEvents(target, events);
    if (sourcePlans) {
      await target.carePlans.clear(); await target.carePlanItems.clear(); await target.planMigrations.clear();
      await target.carePlans.bulkPut(sourcePlans.plans); await target.carePlanItems.bulkPut(sourcePlans.items); await target.planMigrations.bulkPut(sourcePlans.migrations);
    }
    await Promise.all([target.plan.clear(), target.foods.clear(), target.entries.clear(), target.wellbeing.clear(),
      target.workouts.clear(), target.weights.clear(), target.labs.clear(), target.recipes.clear(), target.favorites.clear(), target.frictions.clear()]);
    if (file.recipes) await target.recipes.bulkPut(file.recipes);
    if (file.favorites) await target.favorites.bulkPut(file.favorites);
    if (file.frictions) await target.frictions.bulkPut(file.frictions);
    await target.plan.put(file.plan);
    await target.foods.bulkPut(file.foods);
    await target.entries.bulkPut(file.entries);
    await target.wellbeing.bulkPut(file.wellbeing);
    await target.workouts.bulkPut(file.workouts);
    await target.weights.bulkPut(file.weights);
    await target.labs.bulkPut(file.labs);
    await initialiseModulePreferences(target);
  });
}

export const EXPORT_EVERY_DAYS = 7;

/** §8: remind once a week; not before there is anything worth keeping. */
export function exportDue(lastExportAt: string | undefined, firstDataDate: string | undefined, today: string): boolean {
  if (!firstDataDate) return false;
  const since = lastExportAt ?? firstDataDate;
  return (Date.parse(today) - Date.parse(since)) / 86_400_000 >= (lastExportAt ? EXPORT_EVERY_DAYS : 1);
}
