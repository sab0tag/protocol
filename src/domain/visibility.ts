// Current visibility is separate from historical observation: hide a view without rewriting its denominators.
import { can, type FeatureContext, type FeatureId } from './features';
import type { Checklist, CheckKind } from './checklist';
import type { DayEntry, EntryKind } from './types';
import type { HabitKey } from './habits';
import type { Report } from './report';
import type { weekSummary } from './habits';

export const ENTRY_FEATURES = { meal: 'food.log', med: 'meds.log', water: 'water.log', workout: 'workout.log',
  note: 'day', symptom: 'unwell' } as const satisfies Record<EntryKind, FeatureId>;
const CHECK_FEATURES = { med: 'meds.log', water: 'water.log', workout: 'workout.log', dinner: 'food.log', mode: 'food.log' } as const satisfies Record<CheckKind, FeatureId>;
export const HABIT_FEATURES = { protein: 'food.log', carbs: 'food.log', water: 'water.log', meds: 'meds.log', plan: 'day.checklist' } as const satisfies Record<HabitKey, FeatureId>;

export function entryVisible(e: DayEntry, context: FeatureContext): boolean {
  const feature = e.checkKey === 'food:complete' || e.checkKey === 'dinner' || e.checkKey?.startsWith('mode:') ? 'food.log' : ENTRY_FEATURES[e.kind];
  return can(feature, context) && !(e.kind === 'meal' && e.status === 'planned' && e.menu && !can('menu.ai', context));
}

export function visibleChecklist(c: Checklist, context: FeatureContext): Checklist {
  const items = c.items.filter((i) => can(CHECK_FEATURES[i.kind], context));
  return { ...c, items, total: items.length, done: items.filter((i) => i.done).length,
    ...(!can('workout.log', context) ? { workoutNote: undefined } : {}) };
}

export const fullChecklist = (c: FeatureContext) => ['meds.log', 'water.log', 'food.log', 'workout.log'].every((f) => can(f as FeatureId, c));
export const habitVisible = (key: HabitKey, context: FeatureContext) => can(HABIT_FEATURES[key], context) && (key !== 'plan' || fullChecklist(context));
export function visibleWeek(s: ReturnType<typeof weekSummary>, context: FeatureContext): ReturnType<typeof weekSummary> {
  return { ...s, ...(!can('food.log', context) ? { carbsOk: undefined, proteinOk: undefined } : {}),
    ...(!can('water.log', context) ? { waterOk: undefined } : {}), ...(!can('workout.log', context) ? { showWorkouts: false } : {}),
    ...(!fullChecklist(context) ? { checklistPct: undefined } : {}) };
}

/** Screen, print and shared text use the same projection. The source report/data and historical intervals stay intact. */
export function visibleReport(r: Report, context: FeatureContext): Report {
  const meds = can('meds.log', context), food = can('food.log', context), weight = can('wellbeing.weight', context);
  return { ...r, ...(!meds ? { meds: undefined, prn: [], unscoredMedMarks: undefined } : {}),
    ...(!food ? { deviations: undefined, coincidences: [], medFood: 0 } : {}),
    ...(!food || !can('menu.ai', context) ? { menu: undefined } : {}), ...(!can('progress.labs', context) ? { labs: [] } : {}),
    ...(!weight ? { weightStart: undefined, weightNow: undefined, weightPace: undefined } : {}),
    ...(!can('wellbeing.log', context) ? { avgEnergy: undefined } : {}),
    ...(!fullChecklist(context) ? { checklistPct: undefined } : {}),
    observed: { workout: can('workout.log', context) && r.observed?.workout !== false,
      weight: weight && r.observed?.weight !== false, wellbeing: can('wellbeing.log', context) && r.observed?.wellbeing !== false },
    habits: r.habits.filter((h) => habitVisible(h.key, context)),
  };
}
