// «Ритм дня» (SPEC.md §14.1, D53): the day as a line in time — what was recorded and what the plan still holds,
// so a day without records is never empty. Water is not on the line (it is the ring in «Уже сьогодні»). Pure.
import type { CheckItem } from './checklist';
import { shownTime, timeOf } from './dates';
import { FOOD_COMPLETE } from './habits';
import type { DayEntry } from './types';
import { observedPlannedEntry, scoredDay, type Observation } from './observation';

export type RhythmNode =
  | { kind: 'entry'; at: string; entry: DayEntry } // recorded or planned by the person (a meal, a medicine tick…)
  | { kind: 'dose'; at: string; item: CheckItem } // a dose from the doctor's plan, not marked yet
  | { kind: 'deadline'; at: string }; // «останній прийом їжі до …»

export interface Rhythm {
  nodes: RhythmNode[];
  /** Due today without a time: medicines «раз на день» — one line above the time line. The workout is not repeated here:
   *  its tile on «День» already shows it, with a check when done (D78). */
  anytime: CheckItem[];
}

export function dayRhythm(args: { entries: DayEntry[]; checklist?: { items: CheckItem[] }; lastMealBy?: string; date?: string; observation?: Observation }): Rhythm {
  const nodes: RhythmNode[] = [];
  // R06: the «all written» mark is no row
  for (const e of args.entries) if (e.kind !== 'water' && e.checkKey !== FOOD_COMPLETE && observedPlannedEntry(args.observation, e)) nodes.push({ kind: 'entry', at: shownTime(e) ?? timeOf(e.at), entry: e });
  const anytime: CheckItem[] = [];
  for (const i of args.checklist?.items ?? []) {
    if (i.kind === 'med' && !i.done && !i.skipped) { if (i.time) nodes.push({ kind: 'dose', at: i.time, item: i }); else anytime.push(i); }
  }
  if (args.lastMealBy && nodes.length && (!args.observation || (args.date && scoredDay(args.observation, 'food', args.date)))) nodes.push({ kind: 'deadline', at: args.lastMealBy });
  const order = { entry: 0, dose: 1, deadline: 2 } as const;
  nodes.sort((a, b) => a.at.localeCompare(b.at) || order[a.kind] - order[b.kind]);
  return { nodes, anytime };
}
