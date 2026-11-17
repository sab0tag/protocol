// «День» header (SPEC.md §14.1, D53, D160): the day by name, the date and a greeting. Another day — a swipe across the
// header, or a tap on the date, which opens the week strip (a dot under a day means it has records); the arrows open
// the next / previous week on the day next to this one (D99), or on today when it is there.
import { addDays, format, parseISO, startOfISOWeek } from 'date-fns';
import { uk } from 'date-fns/locale';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useActiveProfile } from '../app/profiles';
import { db } from '../data/db';
import { todayISO, weekStep } from '../domain/dates';
import { greeting } from '../domain/greeting';
import { t } from '../i18n/uk';

const L = t.day;

export function DayHeader({ date, setDate, action }: { date: string; setDate: (d: string) => void; action?: ReactNode }) {
  const currentProfile = useActiveProfile();
  const [week, setWeek] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const down = (e: ReactPointerEvent) => { if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY }; };
  const up = (e: ReactPointerEvent) => {
    const from = swipe.current; swipe.current = null;
    if (!from) return;
    const dx = e.clientX - from.x, dy = e.clientY - from.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) setDate(format(addDays(parseISO(date), dx < 0 ? 1 : -1), 'yyyy-MM-dd'));
  };
  const today = todayISO();
  const monday = startOfISOWeek(parseISO(date));
  const days = Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), 'yyyy-MM-dd'));
  const withRecords = useLiveQuery(async () => new Set((await db.entries.where('at').between(days[0]!, `${days[6]!}￿`).toArray())
    .map((e) => e.at.slice(0, 10))), [days[0]]);
  const isToday = date === today;
  const d = parseISO(date);

  return (
    <header className="protocol-day-heading mb-2 space-y-2" onPointerDown={down} onPointerUp={up} onPointerCancel={() => { swipe.current = null; }} style={{ touchAction: 'pan-y' }}>
      <div>
        {/* ТЗ 17.11, step 3: date and greeting in one line; the section's name stays for screen readers */}
        <h1 className={isToday ? 'sr-only' : 'text-2xl font-semibold tracking-tight'}>{isToday ? L.todayTitle : format(d, 'EEEE, d MMMM', { locale: uk })}</h1>
        <p className="flex flex-wrap items-center gap-x-2 text-base text-muted">
          {isToday && <span data-testid="active-profile">{greeting(new Date(), currentProfile.name)}</span>}
          <button type="button" aria-expanded={week} aria-controls="day-week" onClick={() => setWeek((v) => !v)}
            className="inline-flex min-h-tap items-center gap-1 font-medium text-accent first-letter:uppercase">
            <CalendarDays size={16} aria-hidden />{isToday ? format(d, 'EEEE, d MMMM', { locale: uk }) : L.week}
          </button>
        </p>
      </div>
      {week && <div id="day-week">
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
      </div>}
      {action && <div>{action}</div>}
      {!isToday && (
        <p className="mt-1 text-center"><button type="button" className="min-h-tap px-3 text-accent underline" onClick={() => setDate(today)}>{L.today}</button></p>
      )}
    </header>
  );
}
