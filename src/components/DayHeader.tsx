// «День» header (SPEC.md §14.1, D53): the day by name, a week strip — a dot under a day means it has records —
// Sync status and brand are in AppHeader. A tap on a day opens it; the arrows open the next / previous week
// on the day next to this one (D99), or on today when it is there.
import { addDays, format, parseISO, startOfISOWeek } from 'date-fns';
import { uk } from 'date-fns/locale';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useActiveProfile } from '../app/profiles';
import { db } from '../data/db';
import { todayISO, weekStep } from '../domain/dates';
import { t } from '../i18n/uk';

const L = t.day;

export function DayHeader({ date, setDate, action, remaining }: { date: string; setDate: (d: string) => void; action?: ReactNode; remaining?: number }) {
  const currentProfile = useActiveProfile();
  const today = todayISO();
  const monday = startOfISOWeek(parseISO(date));
  const days = Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), 'yyyy-MM-dd'));
  const withRecords = useLiveQuery(async () => new Set((await db.entries.where('at').between(days[0]!, `${days[6]!}￿`).toArray())
    .map((e) => e.at.slice(0, 10))), [days[0]]);
  const isToday = date === today;
  const d = parseISO(date);

  return (
    <header className="protocol-day-heading mb-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{isToday ? L.todayTitle : format(d, 'EEEE, d MMMM', { locale: uk })}</h1>
          {isToday && <p className="mt-1 text-sm text-muted">{format(d, 'EEEE, d MMMM', { locale: uk })}</p>}
        </div>
        <Link to="/profiles" aria-label={t.profiles.title} className="flex min-h-tap max-w-[45%] items-center truncate rounded-xl border border-line bg-surface px-3 text-sm text-muted" data-testid="active-profile">{currentProfile.name || t.profiles.title}</Link>
      </div>
      {remaining !== undefined && <p className="inline-flex rounded-full bg-accent/10 px-3 py-1 text-sm font-medium text-accent" data-testid="remaining-actions" title={t.todayView.remainingScope}>{t.todayView.remaining(remaining)}</p>}
      <details className="rounded-xl border border-line bg-surface px-3">
        <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-sm font-medium"><CalendarDays size={18} aria-hidden />{t.todayView.chooseDate}</summary>
      <nav aria-label={L.week} className="protocol-calendar mb-2 overflow-x-auto flex items-center gap-1 rounded-xl p-1">
        <button type="button" onClick={() => setDate(weekStep(date, -1, today))} aria-label={L.prevWeek}
          className="flex min-h-tap w-11 shrink-0 items-center justify-center text-muted"><ChevronLeft size={18} aria-hidden /></button>
        <ol className="grid min-w-[332px] flex-1 grid-cols-7 gap-1">
          {days.map((day) => {
            const x = parseISO(day), selected = day === date;
            return (
              <li key={day}>
                <button type="button" onClick={() => setDate(day)} aria-current={selected ? 'date' : undefined}
                  aria-label={format(x, 'EEEE, d MMMM', { locale: uk }) + (withRecords?.has(day) ? `, ${L.hasRecords}` : '')}
                  className={`flex min-h-tap w-full flex-col items-center rounded-xl py-1 ${selected ? 'bg-accent text-on-accent' : day === today ? 'bg-accent/10 text-accent' : 'text-ink'}`}>
                  <span className={`text-xs first-letter:uppercase ${selected ? '' : 'text-muted'}`}>{format(x, 'EEEEEE', { locale: uk })}</span>
                  <span className="tabular text-lg font-medium leading-tight">{format(x, 'd')}</span>
                  <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${withRecords?.has(day) ? (selected ? 'bg-on-accent' : 'bg-accent') : 'bg-transparent'}`} aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>
        <button type="button" onClick={() => setDate(weekStep(date, 1, today))} aria-label={L.nextWeek}
          className="flex min-h-tap w-11 shrink-0 items-center justify-center text-muted"><ChevronRight size={18} aria-hidden /></button>
      </nav>
      </details>
      {action && <div>{action}</div>}
      {!isToday && (
        <p className="mt-1 text-center"><button type="button" className="min-h-tap px-3 text-accent underline" onClick={() => setDate(today)}>{L.today}</button></p>
      )}
    </header>
  );
}
