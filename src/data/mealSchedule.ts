import type { ProtocolDB } from './db';
import type { DayEntry } from '../domain/types';

export class MealScheduleError extends Error {
  constructor(public readonly code: 'changed' | 'not_planned' | 'not_future' | 'same_time') { super(code); }
}

export interface MealScheduleChange { before: DayEntry; after: DayEntry }

/** A move changes the scheduled event in place; it never creates another meal or an outcome. */
export function movedMeal(entry: DayEntry, at: string, now = new Date()): DayEntry {
  if (entry.kind !== 'meal' || entry.status !== 'planned') throw new MealScheduleError('not_planned');
  if (!Number.isFinite(Date.parse(at)) || Date.parse(at) <= now.getTime()) throw new MealScheduleError('not_future');
  if (Date.parse(at) === Date.parse(entry.at)) throw new MealScheduleError('same_time');
  const next: DayEntry = { ...entry, at,
    scheduleChanges: [...(entry.scheduleChanges ?? []), { from: entry.at, to: at, changedAt: now.toISOString() }] };
  // The future proposal has no actual-time mark or skip outcome. The old schedule is retained above.
  delete next.skipReason; delete next.adherence; delete next.markedAt; delete next.timeUnknown; delete next.plannedAt;
  return next;
}

const same = (a: DayEntry | undefined, b: DayEntry) => !!a && JSON.stringify(a) === JSON.stringify(b);

/** Read/check/write is one transaction, so an open stale dialog cannot overwrite a newer outcome. */
export async function rescheduleMeal(target: ProtocolDB, expected: DayEntry, at: string, now = new Date()): Promise<MealScheduleChange> {
  return target.transaction('rw', target.entries, async () => {
    const current = await target.entries.get(expected.id);
    if (!same(current, expected)) throw new MealScheduleError('changed');
    const after = movedMeal(current!, at, now);
    await target.entries.put(after);
    return { before: current!, after };
  });
}

/** Undo is conditional too: do not overwrite a meal edited, completed or moved again in the meantime. */
export async function undoMealSchedule(target: ProtocolDB, change: MealScheduleChange): Promise<void> {
  await target.transaction('rw', target.entries, async () => {
    if (!same(await target.entries.get(change.after.id), change.after)) throw new MealScheduleError('changed');
    await target.entries.put(change.before);
  });
}
