import { SceneHeader } from '../components/SceneHeader';
import { format, parseISO, subDays } from 'date-fns';
import { ExampleNotice } from '../components/ExampleNotice';
import { Loading } from '../components/Recovery';
import { Activity, ChevronRight, Dumbbell, FileText, HeartPulse, Scale } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAllEntries, useFoods, usePlan, useWeights, useWorkouts } from '../data/queries';
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

/** «Прогрес» (SPEC.md §5.7). The charts show accepted measurements and weekly averages against the plan's limit;
 *  the current weight and the change since the start are numbers above it (D23). */
export function Progress() {
  const plan = usePlan();
  const weights = useWeights();
  const entries = useAllEntries();
  const workouts = useWorkouts();
  const foods = useFoods();
  const { can, context } = useFeatures();
  const { observation, ready: observationReady } = useObservation();
  if (!weights || !entries || !workouts || !foods || !observationReady) return <Loading />;

  const sum = weightSummary(weights);
  const weekly = visibleWeek(weekSummary({ plan, entries, workouts, foods, today: todayISO(), observation }), context);

  return (
    <section className="space-y-4 pt-4">
      <SceneHeader title={L.title} description={t.visual.progressHint}>
        <Link to="/report" className="inline-flex min-h-tap items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 text-sm font-medium text-white">
          <FileText size={18} aria-hidden />{L.report}</Link>
      </SceneHeader>
      <ExampleNotice plan={plan} />
      <section aria-label="Огляд прогресу" className="grid grid-cols-2 gap-3">
        {can('wellbeing.weight') && <article className="protocol-card p-4"><Scale size={19} className="mb-2 text-accent" aria-hidden /><h2 className="text-xs text-muted">Вага</h2><p className="mt-1 text-xl font-semibold tabular">{sum.now ? `${kg(sum.now.kg)} кг` : 'Немає записів'}</p><p className="mt-1 text-xs text-muted">{sum.delta != null ? `Від початку: ${signed(sum.delta)} кг` : 'Додайте перше вимірювання'}</p></article>}
        {can('wellbeing.log') && <article className="protocol-card p-4"><HeartPulse size={19} className="mb-2 text-accent" aria-hidden /><h2 className="text-xs text-muted">Самопочуття</h2><p className="mt-1 text-base font-semibold">Ваші записи</p><Link className="mt-2 inline-block text-sm text-accent underline-offset-4 hover:underline" to="/wellbeing/journal">Переглянути щоденник →</Link></article>}
        {can('workout.log') && <article className="protocol-card p-4"><Dumbbell size={19} className="mb-2 text-accent" aria-hidden /><h2 className="text-xs text-muted">Активність за 7 днів</h2><p className="mt-1 text-xl font-semibold tabular">{workouts.filter((w) => w.date >= format(subDays(parseISO(todayISO()), 6), 'yyyy-MM-dd') && w.date <= todayISO()).length}</p><p className="mt-1 text-xs text-muted">Записаних тренувань</p></article>}
        {habitVisible('plan', context) && <article className="protocol-card p-4"><Activity size={19} className="mb-2 text-accent" aria-hidden /><h2 className="text-xs text-muted">План</h2><p className="mt-1 text-base font-semibold">Виконання за тиждень</p><p className="mt-1 text-xs text-muted">Деталі — у підсумку нижче</p></article>}
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
