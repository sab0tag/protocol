import { format, parseISO } from 'date-fns';
import { Loading } from '../components/Recovery';
import { useAllEntries, useFoods, usePlan, useWorkouts } from '../data/queries';
import { habits, weekSummary, type Habit } from '../domain/habits';
import { todayISO } from '../domain/dates';
import { t } from '../i18n/uk';
import { Link } from 'react-router-dom';
import { ProgressTrack } from '../components/ProgressTrack';
import { SceneHeader } from '../components/SceneHeader';

const L = t.progress;

export function Motivation() {
  const plan = usePlan();
  const entries = useAllEntries();
  const workouts = useWorkouts();
  const foods = useFoods();
  if (!entries || !workouts || !foods) return <Loading />;

  return (
    <section className="space-y-4 pt-4">
      <Link to="/progress" className="inline-flex min-h-tap items-center text-sm text-muted">{t.progress.title}</Link>
      <SceneHeader title={t.progress.motivationTitle} />
      <WeekCard summary={weekSummary({ plan, entries, workouts, foods, today: todayISO() })} />
      <HabitsCard list={habits({ plan, entries, workouts, foods, today: todayISO() })} showEmpty />
    </section>
  );
}

export function HabitsCard({ list, showEmpty = false }: { list: Habit[]; showEmpty?: boolean }) {
  if (!list.length) return showEmpty ? <p className="protocol-card rounded-2xl border border-line bg-surface p-3 text-muted">{L.noHabits}</p> : null;
  return (
    <section className="protocol-card rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-semibold">{L.habits}</h2>
      <p className="mb-2 text-sm text-muted">{L.habitsHint}</p>
      <ul className="divide-y divide-line">
        {list.map((habit) => (
          <li key={habit.key} className="space-y-3 py-4">
            <div className="flex items-start justify-between gap-4"><span className="font-medium">{L.habit[habit.key]}</span>
            <span className="shrink-0 text-right text-sm tabular">
              <span className={habit.streak >= 2 ? 'font-semibold text-accent' : ''}>
                {habit.streak >= 2 ? `🌱 ${L.streak(habit.streak)}` : L.ofWeek(habit.last7, habit.days7)}
              </span>
              {habit.best >= 3 && habit.best > habit.streak && <span className="block text-xs text-muted">{L.best(habit.best)}</span>}
            </span></div>
            {habit.days7 > 0 && <ProgressTrack ratio={habit.last7 / habit.days7} label={L.habit[habit.key]} valueText={L.ofWeek(habit.last7, habit.days7)} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WeekCard({ summary }: { summary: ReturnType<typeof weekSummary> }) {
  const tiles: [string, string][] = [];
  if (summary.carbsOk !== undefined) tiles.push([L.weekCarbs, L.ofDays(summary.carbsOk, summary.days)]);
  if (summary.proteinOk !== undefined) tiles.push([L.weekProtein, L.ofDays(summary.proteinOk, summary.days)]);
  if (summary.waterOk !== undefined) tiles.push([L.weekWater, L.ofDays(summary.waterOk, summary.days)]);
  tiles.push([L.weekWorkouts, String(summary.workouts)]);
  if (summary.checklistPct !== undefined) tiles.push([L.weekChecklist, `${summary.checklistPct} %`]);
  return (
    <section className="protocol-card rounded-2xl border border-line bg-surface p-5">
      <h2 className="mb-2 font-semibold">{L.week} <span className="text-sm font-normal text-muted">· {format(parseISO(summary.from), 'dd.MM')}–{format(parseISO(summary.to), 'dd.MM')}</span></h2>
      {summary.days === 0 ? <p className="text-muted">{L.weekNoData}</p> : (
        <dl className="grid grid-cols-2 gap-3 tabular sm:grid-cols-3">
          {tiles.map(([label, value]) => <div key={label} className="protocol-metric"><dt className="text-sm text-muted">{label}</dt><dd className="mt-2 text-xl font-semibold">{value}</dd></div>)}
        </dl>
      )}
    </section>
  );
}
