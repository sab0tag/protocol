import type { AdherenceState, DayEntry } from './types';
import { timeOf } from './dates';

/** Project legacy entries and new adherence details into the patient's explicit outcome states. */
export function adherenceState(entry: DayEntry | undefined): AdherenceState {
  if (!entry) return 'no_data';
  if (entry.adherence === 'uncertain' && entry.status === 'planned') return 'uncertain';
  if (entry.status === 'skipped') return 'skipped';
  if (entry.status === 'done') {
    const plannedTime = entry.kind === 'med' ? entry.checkKey?.match(/^med:.+:(\d{2}:\d{2})$/)?.[1] : undefined;
    return entry.adherence === 'completed_late' || (!entry.timeUnknown && completedLate(timeOf(entry.at), plannedTime))
      ? 'completed_late' : 'completed';
  }
  return 'no_data';
}

/** An explicit uncertainty stops reminders without claiming the dose was taken or skipped. */
export function adherenceResolved(entry: Pick<DayEntry, 'status' | 'adherence'>): boolean {
  return entry.status !== 'planned' || entry.adherence === 'uncertain';
}

export function completedLate(actualTime: string | undefined, plannedTime: string | undefined): boolean {
  return !!actualTime && !!plannedTime && actualTime > plannedTime;
}
