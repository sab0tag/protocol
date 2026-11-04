import { format, parseISO } from 'date-fns';
import type { DayEntry } from '../domain/types';
import { t } from '../i18n/uk';

export function ScheduleHistory({ entry }: { entry: DayEntry }) {
  if (!entry.scheduleChanges?.length) return null;
  const stamp = (at: string) => format(parseISO(at), 'dd.MM.yyyy HH:mm');
  return <details className="text-sm text-muted">
    <summary className="min-h-tap cursor-pointer py-2">{t.reschedule.history}</summary>
    <ul className="space-y-1">{entry.scheduleChanges.map((change, i) => <li key={`${change.changedAt}:${i}`}>{stamp(change.from)} → {stamp(change.to)}</li>)}</ul>
  </details>;
}
