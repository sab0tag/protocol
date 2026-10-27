// «День» header (SPEC.md §14.1, D53): the day by name, a week strip — a dot under a day means it has records —
// and the sync status as a cloud with a mark (R6). A tap on a day opens it; the arrows open the next / previous week
// on the day next to this one (D99), or on today when it is there.
import { addDays, format, parseISO, startOfISOWeek } from 'date-fns';
import { uk } from 'date-fns/locale';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Cloud, CloudAlert, CloudCheck, CloudOff, Heart, TreePine } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useActiveProfile } from '../app/profiles';
import { greeting, dailyPhrase } from '../domain/greeting';
import { db, inDemo } from '../data/db';
import { todayISO, weekStep } from '../domain/dates';
import { t } from '../i18n/uk';
import { useSync, type SyncStatus } from '../sync/runner';

const L = t.day;
const CLOUD: Record<SyncStatus, { Icon: typeof Cloud; tone: string }> = {
  off: { Icon: CloudOff, tone: 'text-muted' }, idle: { Icon: CloudCheck, tone: 'text-accent' }, syncing: { Icon: Cloud, tone: 'text-muted animate-pulse' },
  offline: { Icon: CloudOff, tone: 'text-warn' }, error: { Icon: CloudAlert, tone: 'text-warn' },
};

export function DayHeader({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  const navigate = useNavigate();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  const currentProfile = useActiveProfile();
  const name = inDemo() ? '' : currentProfile.name;
  const showMotivation = inDemo() || currentProfile.motivation !== false;
  const today = todayISO();
  const monday = startOfISOWeek(parseISO(date));
  const days = Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), 'yyyy-MM-dd'));
  const withRecords = useLiveQuery(async () => new Set((await db.entries.where('at').between(days[0]!, `${days[6]!}￿`).toArray())
    .map((e) => e.at.slice(0, 10))), [days[0]]);
  const status = useSync((s) => s.status);
  const { Icon } = CLOUD[status];
  const isToday = date === today;
  const d = parseISO(date);

  return (
    <header className="protocol-day-hero relative mb-4 overflow-hidden rounded-[1.35rem] px-3 pb-3 pt-4 text-white sm:px-5">
      <div className="relative z-10">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-lg font-semibold"><TreePine size={22} className="text-emerald-200" aria-hidden />Протокол</span>
          <button type="button" onClick={() => navigate('/sync')} aria-label={L.syncStatus[status]} className="flex min-h-tap min-w-tap items-center justify-center rounded-full border border-white/30 bg-black/25"><Icon size={20} className="text-white" aria-hidden /></button>
        </div>
        <Link to="/profiles" aria-label={t.profiles.title} className="block break-words text-xl font-semibold" data-testid="greeting">{greeting(now, name)}</Link>
        {showMotivation && <p data-testid="daily-phrase" className="mt-1 flex items-center gap-2 text-sm text-white/85">{dailyPhrase(now)} <Heart size={16} className="fill-emerald-300 text-emerald-300" aria-hidden /></p>}
      <h1 className="mt-4 text-lg font-semibold">{isToday ? L.todayTitle : format(d, 'EEEE, d MMMM', { locale: uk })}</h1>
      {isToday && <p className="mt-1 text-sm text-white/80">{format(d, 'EEEE, d MMMM', { locale: uk })}</p>}
      <nav aria-label={L.week} className="protocol-calendar mt-2 flex items-center gap-1 rounded-[1.15rem] p-1">
        <button type="button" onClick={() => setDate(weekStep(date, -1, today))} aria-label={L.prevWeek}
          className="flex min-h-tap w-7 shrink-0 items-center justify-center text-white/80"><ChevronLeft size={18} aria-hidden /></button>
        <ol className="grid flex-1 grid-cols-7 gap-1">
          {days.map((day) => {
            const x = parseISO(day), selected = day === date;
            return (
              <li key={day}>
                <button type="button" onClick={() => setDate(day)} aria-current={selected ? 'date' : undefined}
                  aria-label={format(x, 'EEEE, d MMMM', { locale: uk }) + (withRecords?.has(day) ? `, ${L.hasRecords}` : '')}
                  className={`flex w-full flex-col items-center rounded-xl py-1 ${selected ? 'bg-emerald-200 text-emerald-950' : day === today ? 'text-emerald-200' : 'text-white'}`}>
                  <span className={`text-xs first-letter:uppercase ${selected ? '' : 'text-white/70'}`}>{format(x, 'EEEEEE', { locale: uk })}</span>
                  <span className="tabular text-lg font-medium leading-tight">{format(x, 'd')}</span>
                  <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${withRecords?.has(day) ? (selected ? 'bg-emerald-950' : 'bg-emerald-200') : 'bg-transparent'}`} aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>
        <button type="button" onClick={() => setDate(weekStep(date, 1, today))} aria-label={L.nextWeek}
          className="flex min-h-tap w-7 shrink-0 items-center justify-center text-white/80"><ChevronRight size={18} aria-hidden /></button>
      </nav>
      {!isToday && (
        <p className="mt-1 text-center"><button type="button" className="min-h-tap px-3 text-emerald-200 underline" onClick={() => setDate(today)}>{L.today}</button></p>
      )}
      </div>
    </header>
  );
}
