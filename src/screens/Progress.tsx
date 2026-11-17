import { format, parseISO } from 'date-fns';
import { ExampleNotice } from '../components/ExampleNotice';
import { Loading } from '../components/Recovery';
import { ChevronRight, Dumbbell, FileText, HeartPulse, Scale, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAllEntries, useAllWellbeing, useFoods, usePlan, useWeights, useWorkouts } from '../data/queries';
import { todayISO } from '../domain/dates';
import { weekSummary } from '../domain/habits';
import { weightSummary } from '../domain/progress';
import { t } from '../i18n/uk';
import { useObservation } from '../app/observation';
import { WeekCard } from './Motivation';
import { WeightCard } from './Weight';
import { useFeatures } from '../app/features';
import { visibleWeek } from '../domain/visibility';

const L = t.progress;
const kg = (n: number) => n.toLocaleString('uk-UA', { maximumFractionDigits: 1 });
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${kg(Math.abs(n))}`;
const dm = (d: string) => format(parseISO(d), 'dd.MM');

/** D146 (ТЗ Progress 2.0): a card is a real number, the period it is counted over, and the way to the records behind it. */
function Card({ icon: Icon, title, value, detail, period, to, link }: { icon: LucideIcon; title: string; value: string; detail: string; period?: string; to?: string; link: string }) {
  return (
    <article className="protocol-card flex flex-col p-4">
      <Icon size={19} className="mb-2 text-accent" aria-hidden /><h2 className="text-xs text-muted">{title}</h2>
      <p className="mt-1 text-xl font-semibold tabular">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
      {period && <p className="mt-1 text-xs text-muted">{period}</p>}
      {to && <Link to={to} className="mt-auto inline-flex min-h-tap items-end pt-1 text-sm text-accent underline-offset-4 hover:underline">{link}</Link>}
    </article>
  );
}

/** «Результати» (SPEC.md §5.7, UI-RESULTS-01). Two separate parts: what was measured and recorded, with no goal applied
 *  to it, and how many days the records kept the plan's goals and limits — never one combined health score.
 *  The doctor's report opens from here; sharing it still needs its own explicit consent on that screen (D158). */
export function Progress() {
  const plan = usePlan();
  const weights = useWeights();
  const entries = useAllEntries();
  const workouts = useWorkouts();
  const foods = useFoods();
  const wellbeing = useAllWellbeing();
  const { can, context } = useFeatures();
  const { observation, ready: observationReady } = useObservation();
  if (!weights || !entries || !workouts || !foods || !wellbeing || !observationReady) return <Loading />;

  const sum = weightSummary(weights);
  const weekly = visibleWeek(weekSummary({ plan, entries, workouts, foods, today: todayISO(), observation }), context);
  const week = L.cardWeek(dm(weekly.from), dm(weekly.to)); // the same seven days for every card below
  const wellDays = new Set(wellbeing.filter((w) => w.date >= weekly.from && w.date <= weekly.to
    && (w.energy || w.mood || w.sleep || w.symptoms.length || w.note)).map((w) => w.date)).size;
  const showResults = can('wellbeing.weight') || can('wellbeing.log') || can('workout.log');
  // The workout count is a record, shown with the results; the goals part keeps only what is measured against the plan.
  const goals = can('workout.log') ? { ...weekly, showWorkouts: false } : weekly;

  return (
    <section className="space-y-5 pt-4">
      <header className="protocol-results-heading space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{L.title}</h1>
          <Link to="/report" className="protocol-action-secondary"><FileText size={18} aria-hidden />{L.report}</Link>
        </div>
        <p className="text-sm text-muted">{L.reportHint}</p>
      </header>
      <ExampleNotice plan={plan} />
      {showResults && <section aria-labelledby="results-recorded" className="space-y-3">
        <div><h2 id="results-recorded" className="text-lg font-semibold">{L.recorded}</h2><p className="text-sm text-muted">{L.recordedHint}</p></div>
        <div className="grid grid-cols-2 gap-3">
          {can('wellbeing.weight') && <Card icon={Scale} title={L.weight} value={sum.now ? `${kg(sum.now.kg)} ${L.kg}` : '—'}
            detail={sum.delta != null ? L.cardWeightDelta(dm(sum.start!.date), signed(sum.delta)) : L.cardWeightFirst}
            {...(sum.now ? { period: L.cardLast(dm(sum.now.date)) } : {})} to="/weight" link={L.cardWeightLink} />}
          {can('wellbeing.log') && <Card icon={HeartPulse} title={t.well.title} value={L.cardDays(wellDays)} detail={L.cardWellDetail}
            period={week} to="/wellbeing/journal" link={L.cardWellLink} />}
          {can('workout.log') && <Card icon={Dumbbell} title={L.cardActivity} value={String(weekly.workouts)} detail={L.cardWorkouts}
            period={week} to="/workout" link={L.cardWorkoutLink} />}
        </div>
        {can('wellbeing.weight') && <WeightCard />}
      </section>}
      <section aria-labelledby="results-goals" className="space-y-3">
        <div><h2 id="results-goals" className="text-lg font-semibold">{L.goals}</h2><p className="text-sm text-muted">{L.goalsHint}</p></div>
        <WeekCard summary={goals} variant="rings" />
        {can('progress.week') && <Link to="/week" className="inline-flex min-h-tap items-center text-sm text-accent underline-offset-4 hover:underline">{L.cardPlanLink}</Link>}
      </section>
      <nav aria-label={L.details} className="grid grid-cols-2 gap-2">
        {[
          { to: '/progress/labs', label: L.labs, feature: 'progress.labs' as const },
          { to: '/progress/motivation', label: L.motivationTitle, feature: 'progress.patterns' as const },
          { to: '/progress/insights', label: L.insightsTitle, feature: 'progress.patterns' as const },
        ].filter(({ feature }) => can(feature)).map(({ to, label }) => (
          <Link key={to} to={to} className="flex min-h-tap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 font-medium">
            <span>{label}</span><ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
          </Link>
        ))}
      </nav>
    </section>
  );
}
