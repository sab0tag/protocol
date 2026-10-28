import { SceneHeader } from '../components/SceneHeader';
import { Loading } from '../components/Recovery';
import { useAllEntries, useAllWellbeing, useFoods, usePlan, useWorkouts } from '../data/queries';
import { patterns } from '../domain/progress';
import { t } from '../i18n/uk';
import { Link } from 'react-router-dom';
import { useObservation } from '../app/observation';
import { ExampleNotice } from '../components/ExampleNotice';

export function Insights() {
  const { observation, ready: observationReady } = useObservation();
  const plan = usePlan();
  const entries = useAllEntries();
  const wellbeing = useAllWellbeing();
  const workouts = useWorkouts();
  const foods = useFoods();
  if (!entries || !wellbeing || !workouts || !foods || !observationReady) return <Loading />;
  const found = patterns({ entries, wellbeing, workouts, foods, observation, ...(plan ? { plan } : {}) });

  return (
    <section className="space-y-4 pt-4">
      <Link to="/progress" className="inline-flex min-h-tap items-center text-sm text-muted">{t.progress.title}</Link>
      <SceneHeader title={t.progress.insightsTitle} />
      <ExampleNotice plan={plan} />
      <section className="protocol-card rounded-2xl border border-line bg-surface p-3">
        <h2 className="font-semibold">{t.progress.patterns}</h2>
        <p className="mb-2 text-sm text-muted">{t.progress.patternsHint}</p>
        {found.length
          ? <ul className="list-disc space-y-1 pl-5">{found.map((pattern) => <li key={pattern.text}>{pattern.text}</li>)}</ul>
          : <p className="text-muted">{t.progress.noPatterns}</p>}
      </section>
    </section>
  );
}
