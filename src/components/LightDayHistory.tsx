import { format, parseISO } from 'date-fns';
import type { LightDayHistory } from '../domain/lightDay';
import { t } from '../i18n/uk';

/** The same dated facts in progress/week, report and print; no commands or offer counters here. */
export function LightDayHistoryView({ history, workouts, showEmpty = false }: { history?: LightDayHistory; workouts?: number; showEmpty?: boolean }) {
  if (!history || (!showEmpty && !history.count)) return null;
  return <section aria-label={t.lightDay.history} className="mb-3 space-y-1 rounded-xl border border-line p-3 text-sm">
    <p className="font-medium">{t.lightDay.summary(history.count, history.days)}</p>
    {history.count > 0 && <><p>{t.lightDay.dates(history.dates.map((d) => format(parseISO(d), 'dd.MM.yyyy')).join(', '))}</p>
      <p className="text-muted">{t.lightDay.hint}</p></>}
    {!!workouts && <p>{t.lightDay.workouts(workouts)}</p>}
  </section>;
}
