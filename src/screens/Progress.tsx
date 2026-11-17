import { format, parseISO } from 'date-fns';
import { ChevronRight, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ExampleNotice } from '../components/ExampleNotice';
import { Loading } from '../components/Recovery';
import { useAllEntries, useFoods, usePlan, useWeights, useWorkouts } from '../data/queries';
import { todayISO } from '../domain/dates';
import { untilVisit, weekPhrase, weekResults } from '../domain/results';
import { t } from '../i18n/uk';
import { useObservation } from '../app/observation';
import { useFeatures } from '../app/features';
import type { FeatureId } from '../domain/features';

const L = t.progress;
const dm = (d: string) => format(parseISO(d), 'dd.MM');
const kg = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('uk-UA', { maximumFractionDigits: 1 })} ${L.kg}`;

/** «Результати» (D165, ТЗ «спрощення» 17.11): the week in one phrase, three numbers and the time to the visit — counted from
 *  the person's records against their own plan, never a health score. The main action is the doctor's report; sharing it
 *  still needs its own consent on that screen (D158). Patterns, motivation and the rest are links. */
export function Progress() {
  const plan = usePlan();
  const weights = useWeights();
  const entries = useAllEntries();
  const workouts = useWorkouts();
  const foods = useFoods();
  const { can } = useFeatures();
  const { observation, ready: observationReady } = useObservation();
  if (!weights || !entries || !workouts || !foods || !observationReady) return <Loading />;

  const today = todayISO();
  const raw = weekResults({ plan, entries, workouts, foods, weights, today, observation });
  // a module that is off has no number and no word in the phrase
  const r = { ...raw, ...(can('meds.log') ? {} : { meds: undefined }), ...(can('food.log') ? {} : { food: undefined }), ...(can('water.log') ? {} : { water: undefined }),
    ...(can('wellbeing.weight') ? {} : { weight: undefined }) };
  type Num = { label: string; value: string };
  const numbers = ([
    r.meds && { label: L.nMeds, value: L.of(r.meds.done, r.meds.total) },
    r.food && { label: L.nFood, value: L.of(r.food.onPlan, r.food.days) },
    r.water ? { label: L.nWater, value: L.of(r.water.met, r.water.days) } : r.weight ? { label: L.nWeight, value: kg(r.weight.delta) } : undefined,
    { label: L.nRecorded, value: L.of(r.recorded, 7) },
  ] as (Num | undefined | 0)[]).filter((x): x is Num => !!x).slice(0, 3);
  const visit = plan?.nextCheckup;
  const left = untilVisit(visit?.date, today);
  const links: { to: string; label: string; feature: FeatureId }[] = [
    { to: '/week', label: L.weekLink, feature: 'progress.week' },
    { to: '/weight', label: L.weight, feature: 'wellbeing.weight' },
    { to: '/progress/labs', label: L.labs, feature: 'progress.labs' },
    { to: '/wellbeing/journal', label: t.well.title, feature: 'wellbeing.log' },
    { to: '/workout', label: L.cardActivity, feature: 'workout.log' },
    { to: '/progress/insights', label: L.insightsTitle, feature: 'progress.patterns' },
    { to: '/progress/motivation', label: L.motivationTitle, feature: 'progress.patterns' },
  ];
  const range = L.weekRange(dm(r.from), dm(r.to));

  return (
    <section className="space-y-4 pt-4">
      <h1 className="text-3xl font-semibold tracking-tight">{L.title}</h1>
      <ExampleNotice plan={plan} />
      <section aria-label={range} className="protocol-card space-y-3 p-4">
        <p className="text-sm text-muted">{range}</p>
        <p data-testid="week-phrase" className="text-xl font-semibold">{weekPhrase(r)}</p>
        <dl className="grid grid-cols-3 gap-2">
          {numbers.map((n) => (
            <div key={n.label} className="rounded-xl bg-bg p-2">
              <dt className="text-xs text-muted">{n.label}</dt><dd className="tabular text-lg font-semibold">{n.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {visit && left && (
        <Link to="/plan/checkup" className="protocol-card flex min-h-tap items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1"><span className="block font-semibold">{L.toVisit(left)}</span>
            <span className="block text-sm text-muted">{L.visitOn(visit.date.split('-').reverse().join('.'))}</span></span>
          <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
        </Link>
      )}
      <Link to="/report" className="protocol-action flex w-full"><FileText size={20} aria-hidden />{L.report}</Link>
      <nav aria-label={L.more} className="protocol-card divide-y divide-line p-0">
        {links.filter(({ feature }) => can(feature)).map(({ to, label }) => (
          <Link key={to} to={to} className="flex min-h-tap items-center justify-between gap-2 px-4 py-2 font-medium">
            <span>{label}</span><ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
          </Link>
        ))}
      </nav>
    </section>
  );
}
