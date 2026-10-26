import { Loading } from '../components/Recovery';
import { useAllEntries, useAllWellbeing, useFoods, usePlan, useWorkouts } from '../data/queries';
import { patterns } from '../domain/progress';
import { t } from '../i18n/uk';
import { Link } from 'react-router-dom';

export function Insights() {
  const plan = usePlan();
  const entries = useAllEntries();
  const wellbeing = useAllWellbeing();
  const workouts = useWorkouts();
  const foods = useFoods();
  if (!entries || !wellbeing || !workouts || !foods) return <Loading />;
  const found = patterns({ entries, wellbeing, workouts, foods, ...(plan ? { plan } : {}) });

  return (
    <section className="space-y-4 pt-4">
      <Link to="/progress" className="inline-flex min-h-tap items-center text-sm text-muted">{t.progress.title}</Link>
      <h1 className="text-2xl font-semibold">{t.progress.insightsTitle}</h1>
      <section className="rounded-2xl border border-line bg-surface p-3">
        <h2 className="font-semibold">{t.progress.patterns}</h2>
        <p className="mb-2 text-sm text-muted">{t.progress.patternsHint}</p>
        {found.length
          ? <ul className="list-disc space-y-1 pl-5">{found.map((pattern) => <li key={pattern.text}>{pattern.text}</li>)}</ul>
          : <p className="text-muted">{t.progress.noPatterns}</p>}
      </section>
    </section>
  );
}
