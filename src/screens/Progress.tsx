import { SceneHeader } from '../components/SceneHeader';
import { format, parseISO } from 'date-fns';
import { ExampleNotice } from '../components/ExampleNotice';
import { Loading } from '../components/Recovery';
import { Activity, ChevronRight, Dumbbell, FileText, HeartPulse, Scale, type LucideIcon } from 'lucide-react';
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
import { habitVisible, visibleWeek } from '../domain/visibility';

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

/** «Прогрес» (SPEC.md §5.7). The charts show accepted measurements and weekly averages against the plan's limit;
 *  the current weight and the change since the start are numbers above it (D23). */
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

  return (
    <section className="space-y-4 pt-4">
      <SceneHeader title={L.title} description={t.visual.progressHint}>
        <Link to="/report" className="inline-flex min-h-tap items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 text-sm font-medium text-white">
          <FileText size={18} aria-hidden />{L.report}</Link>
      </SceneHeader>
      <ExampleNotice plan={plan} />
      <section aria-label="Огляд прогресу" className="grid grid-cols-2 gap-3">
        {can('wellbeing.weight') && <Card icon={Scale} title={L.weight} value={sum.now ? `${kg(sum.now.kg)} ${L.kg}` : '—'}
          detail={sum.delta != null ? L.cardWeightDelta(dm(sum.start!.date), signed(sum.delta)) : L.cardWeightFirst}
          {...(sum.now ? { period: L.cardLast(dm(sum.now.date)) } : {})} to="/weight" link={L.cardWeightLink} />}
        {can('wellbeing.log') && <Card icon={HeartPulse} title={t.well.title} value={L.cardDays(wellDays)} detail={L.cardWellDetail}
          period={week} to="/wellbeing/journal" link={L.cardWellLink} />}
        {can('workout.log') && <Card icon={Dumbbell} title={L.cardActivity} value={String(weekly.workouts)} detail={L.cardWorkouts}
          period={week} to="/workout" link={L.cardWorkoutLink} />}
        {habitVisible('plan', context) && <Card icon={Activity} title={L.cardPlan} value={weekly.checklistPct != null ? `${weekly.checklistPct} %` : '—'}
          detail={weekly.checklistPct != null ? L.cardPlanDetail(weekly.days) : L.cardPlanNone} period={week}
          {...(can('progress.week') ? { to: '/week' } : {})} link={L.cardPlanLink} />}
      </section>
      <WeekCard summary={weekly} variant="rings" />
      {can('wellbeing.weight') && <WeightCard />}
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
