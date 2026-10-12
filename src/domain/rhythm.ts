// «Ритм дня» (SPEC.md §14.1, D53): the day as a line in time — what was recorded and what the plan still holds,
// so a day without records is never empty. Water is not on the line (it is the ring in «Уже сьогодні»). Pure.
import type { CheckItem } from './checklist';
import { shownTime, timeOf } from './dates';
import type { DayEntry } from './types';

export type RhythmNode =
  | { kind: 'entry'; at: string; entry: DayEntry } // recorded or planned by the person (a meal, a medicine tick…)
  | { kind: 'dose'; at: string; item: CheckItem } // a dose from the doctor's plan, not marked yet
  | { kind: 'deadline'; at: string }; // «останній прийом їжі до …»

export interface Rhythm {
  nodes: RhythmNode[];
  /** Due today without a time: medicines «раз на день», the workout of a workout day — one line above the time line. */
  anytime: CheckItem[];
}

export function dayRhythm(args: { entries: DayEntry[]; checklist?: { items: CheckItem[] }; lastMealBy?: string }): Rhythm {
  const nodes: RhythmNode[] = [];
  for (const e of args.entries) if (e.kind !== 'water') nodes.push({ kind: 'entry', at: shownTime(e) ?? timeOf(e.at), entry: e });
  const anytime: CheckItem[] = [];
  for (const i of args.checklist?.items ?? []) {
    if (i.kind === 'med' && !i.done && !i.skipped) { if (i.time) nodes.push({ kind: 'dose', at: i.time, item: i }); else anytime.push(i); }
    if (i.kind === 'workout' && !i.done) anytime.push(i);
  }
  if (args.lastMealBy && nodes.length) nodes.push({ kind: 'deadline', at: args.lastMealBy });
  const order = { entry: 0, dose: 1, deadline: 2 } as const;
  nodes.sort((a, b) => a.at.localeCompare(b.at) || order[a.kind] - order[b.kind]);
  return { nodes, anytime };
}
