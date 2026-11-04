import { format } from 'date-fns';
import { adherenceState } from './adherence';
import { buildChecklist, type CheckItem } from './checklist';
import { byAt } from './dates';
import { can, type FeatureContext } from './features';
import type { Observation } from './observation';
import { dayFocus, type DayFocus } from './reminders';
import { dayRhythm } from './rhythm';
import type { DayEntry, Food, Plan, Workout } from './types';
import { entryVisible, visibleChecklist } from './visibility';

export interface DayPresentationInput {
  plan: Plan | undefined;
  date: string;
  /** Already scoped to this day by the existing data query; no timezone/storage migration here. */
  entries: DayEntry[];
  workouts: Workout[];
  foods: Map<string, Food>;
  context: FeatureContext;
  now: Date;
  observation?: Observation;
  light?: boolean;
  lastMealBy?: string;
  snoozed?: Record<string, number>;
}

function executionSummary(items: CheckItem[]) {
  return {
    total: items.length,
    done: items.filter(item => item.done).length,
    skipped: items.filter(item => item.skipped).length,
    uncertain: items.filter(item => item.uncertain).length,
    pending: items.filter(item => !item.done && !item.skipped && !item.uncertain).length,
  };
}

/** Read-only adapter over existing selectors. It never chooses clinical priority or changes an outcome. */
export function presentDay(input: DayPresentationInput) {
  const { plan, date, context, now, observation } = input;
  const visible = input.entries.filter(entry => entryVisible(entry, context));
  const entries = visible.filter(entry => !input.light || !['meal', 'water', 'workout'].includes(entry.kind));
  const checklist = visibleChecklist(buildChecklist({ plan, date, entries: input.entries,
    workouts: input.workouts, foods: input.foods, now, observation }), context);
  const rhythm = dayRhythm({ entries, date, observation, checklist,
    ...(can('food.log', context) && input.lastMealBy ? { lastMealBy: input.lastMealBy } : {}) });
  const today = format(now, 'yyyy-MM-dd');
  const focus: DayFocus = date > today ? { missed: [] } : dayFocus({
    entries: visible,
    plan: plan && !can('meds.log', context) ? { ...plan, prescriptions: [] } : plan,
    date, now: date === today ? now : new Date(`${date}T23:59:00`), observation, snoozed: input.snoozed,
  });
  const goals = checklist.items.filter(item => item.kind === 'water' || item.kind === 'mode');
  const actions = checklist.items.filter(item => item.kind !== 'water' && item.kind !== 'mode');
  const records = visible.filter(entry => entry.status !== 'planned' || entry.adherence === 'uncertain')
    .sort(byAt).map(entry => ({ entry, outcome: adherenceState(entry) }));
  return {
    entries, checklist, rhythm, focus, goals,
    /** Counts canonical checklist actions only; quantitative goals and ad-hoc records are not mandatory tasks. */
    execution: { items: actions, ...executionSummary(actions) },
    records,
  };
}
