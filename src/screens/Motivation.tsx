import { format, parseISO } from 'date-fns';
import { Loading } from '../components/Recovery';
import { useAllEntries, useFoods, usePlan, useWorkouts } from '../data/queries';
import { habits, weekSummary, type Habit } from '../domain/habits';
import { todayISO } from '../domain/dates';
import { t } from '../i18n/uk';
import { Link } from 'react-router-dom';
import { ProgressTrack, type ProgressTone } from '../components/ProgressTrack';
import { ProgressRing } from '../components/ProgressRing';
import { SceneHeader } from '../components/SceneHeader';
import { useObservation } from '../app/observation';
import { ExampleNotice } from '../components/ExampleNotice';

const L = t.progress;

export function Motivation() {
  const { observation, ready: observationReady } = useObservation();
  const plan = usePlan();
  const entries = useAllEntries();
  const workouts = useWorkouts();
  const foods = useFoods();
  if (!entries || !workouts || !foods || !observationReady) return <Loading />;

  return (
    <section className="space-y-4 pt-4">
      <Link to="/progress" className="inline-flex min-h-tap items-center text-sm text-muted">{t.progress.title}</Link>
      <SceneHeader title={t.progress.motivationTitle} />
      <ExampleNotice plan={plan} />
      <WeekCard summary={weekSummary({ plan, entries, workouts, foods, today: todayISO(), observation })} />
      <HabitsCard list={habits({ plan, entries, workouts, foods, today: todayISO(), observation })} showEmpty />
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
            <div className="flex items-start justify-between gap-4"><span className="min-w-0 flex-1 break-words font-medium">{L.habit[habit.key]}</span>
            <span className="max-w-[55%] shrink-0 break-words text-right text-sm tabular">
              <span className={habit.streak >= 2 ? 'font-semibold text-accent' : ''}>
                {habit.streak >= 2 ? `🌱 ${L.streak(habit.streak)}` : L.ofWeek(habit.last7, habit.days7)}
              </span>
              {habit.best >= 3 && habit.best > habit.streak && <span className="block text-xs text-muted">{L.best(habit.best)}</span>}
            </span></div>
            {habit.days7 > 0 && <ProgressTrack ratio={habit.last7 / habit.days7} label={L.habit[habit.key]} valueText={L.ofWeek(habit.last7, habit.days7)}
              tone={habit.key === 'water' ? 'water' : habit.key === 'protein' ? 'protein' : habit.key === 'meds' ? 'meds' : habit.key === 'carbs' ? 'carbs' : 'accent'} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WeekCard({ summary, variant = 'tiles' }: { summary: ReturnType<typeof weekSummary>; variant?: 'tiles' | 'rings' }) {
  if (variant === 'rings') {
    type Metric = { label: string; count: number; total: number; tone: ProgressTone; percent?: boolean };
    const metrics: Metric[] = [];
    if (summary.carbsOk !== undefined) metrics.push({
      label: L.weekCarbs, count: summary.carbsOk, total: summary.knownDays?.carbs ?? summary.days, tone: 'carbs',
    });
    if (summary.proteinOk !== undefined) metrics.push({
      label: L.weekProtein, count: summary.proteinOk, total: summary.knownDays?.protein ?? summary.days, tone: 'protein',
    });
    if (summary.waterOk !== undefined) metrics.push({
      label: L.weekWater, count: summary.waterOk, total: summary.knownDays?.water ?? summary.days, tone: 'water',
    });
    if (summary.checklistPct !== undefined) metrics.push({
      label: L.weekChecklist, count: summary.checklistPct, total: 100, tone: 'accent', percent: true,
    });

    return (
      <section className="protocol-card rounded-2xl border border-line bg-surface p-3 sm:p-5">
        <h2 className="mb-2 font-semibold">{L.week} <span className="text-sm font-normal text-muted">· {format(parseISO(summary.from), 'dd.MM')}–{format(parseISO(summary.to), 'dd.MM')}</span></h2>
        {summary.days === 0 ? <p className="text-muted">{L.weekNoData}</p> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {metrics.filter((metric) => metric.total > 0).map((metric) => {
              const ratio = metric.count / metric.total;
              const value = metric.percent ? `${metric.count} %` : L.ofDays(metric.count, metric.total);
              return (
                <li key={metric.label} className={`protocol-metric protocol-week-metric flex min-w-0 flex-col items-center text-center protocol-progress-${metric.tone}`}>
                  <span className="min-h-8 text-sm text-muted">{metric.label}</span>
                  <ProgressRing ratio={ratio} tone={metric.tone} label={metric.label} valueText={value} className="protocol-week-ring">
                    <span className="tabular text-base font-semibold">{Math.round(ratio * 100)}%</span>
                  </ProgressRing>
                  <span className="text-sm tabular">{value}</span>
                </li>
              );
            })}
            <li className="protocol-metric protocol-week-metric flex min-w-0 flex-col items-center justify-center text-center">
              <span className="min-h-8 text-sm text-muted">{L.weekWorkouts}</span>
              <span className="tabular text-3xl font-semibold">{summary.workouts}</span>
            </li>
          </ul>
        )}
      </section>
    );
  }

  const tiles: [string, string][] = [];
  if (summary.carbsOk !== undefined) tiles.push([L.weekCarbs, L.ofDays(summary.carbsOk, summary.knownDays?.carbs ?? summary.days)]);
  if (summary.proteinOk !== undefined) tiles.push([L.weekProtein, L.ofDays(summary.proteinOk, summary.knownDays?.protein ?? summary.days)]);
  if (summary.waterOk !== undefined) tiles.push([L.weekWater, L.ofDays(summary.waterOk, summary.knownDays?.water ?? summary.days)]);
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
