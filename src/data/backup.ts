// Export / import of all data as JSON (SPEC.md §5.8, §8) — the only backup in v0.
import type { DayEntry, Food, LabResult, Recipe, WeightLog, Wellbeing, Workout } from '../domain/types';
import { db, type PlanRow, type ProtocolDB } from './db';

export const FORMAT = 'protocol-export';
export const VERSION = 1;

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
}

export async function exportAll(target: ProtocolDB = db, now = new Date()): Promise<ExportFile> {
  const plan = await target.plan.get('main');
  if (!plan) throw new Error('Немає плану — нічого зберігати.');
  return {
    format: FORMAT, version: VERSION, exportedAt: now.toISOString(), plan,
    foods: await target.foods.toArray(), entries: await target.entries.toArray(), wellbeing: await target.wellbeing.toArray(),
    workouts: await target.workouts.toArray(), weights: await target.weights.toArray(), labs: await target.labs.toArray(),
    recipes: await target.recipes.toArray(),
  };
}

/** Checks the file before anything is touched; then replaces everything in one transaction. */
export function parseExport(text: string): ExportFile {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('Це не файл копії: не вдалося прочитати JSON.'); }
  const d = data as Partial<ExportFile>;
  if (d.format !== FORMAT) throw new Error('Це не файл копії «Протоколу».');
  if (typeof d.version !== 'number' || d.version > VERSION) throw new Error('Файл з новішої версії застосунку — оновіть застосунок.');
  if (!d.plan || d.plan.id !== 'main') throw new Error('У файлі немає плану.');
  for (const k of ['foods', 'entries', 'wellbeing', 'workouts', 'weights', 'labs'] as const) {
    if (!Array.isArray(d[k])) throw new Error(`У файлі пошкоджено розділ «${k}».`);
  }
  if (d.recipes !== undefined && !Array.isArray(d.recipes)) throw new Error('У файлі пошкоджено розділ «recipes».');
  return d as ExportFile;
}

export async function importAll(file: ExportFile, target: ProtocolDB = db): Promise<void> {
  await target.transaction('rw', [target.plan, target.foods, target.entries, target.wellbeing, target.workouts, target.weights, target.labs, target.recipes], async () => {
    await Promise.all([target.plan.clear(), target.foods.clear(), target.entries.clear(), target.wellbeing.clear(),
      target.workouts.clear(), target.weights.clear(), target.labs.clear(), target.recipes.clear()]);
    if (file.recipes) await target.recipes.bulkPut(file.recipes);
    await target.plan.put(file.plan);
    await target.foods.bulkPut(file.foods);
    await target.entries.bulkPut(file.entries);
    await target.wellbeing.bulkPut(file.wellbeing);
    await target.workouts.bulkPut(file.workouts);
    await target.weights.bulkPut(file.weights);
    await target.labs.bulkPut(file.labs);
  });
}

export const EXPORT_EVERY_DAYS = 7;

/** §8: remind once a week; not before there is anything worth keeping. */
export function exportDue(lastExportAt: string | undefined, firstDataDate: string | undefined, today: string): boolean {
  if (!firstDataDate) return false;
  const since = lastExportAt ?? firstDataDate;
  return (Date.parse(today) - Date.parse(since)) / 86_400_000 >= (lastExportAt ? EXPORT_EVERY_DAYS : 1);
}
