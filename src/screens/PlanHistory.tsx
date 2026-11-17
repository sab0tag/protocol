import { PlanVersions } from '../components/PlanVersions';
import { ExampleNotice } from '../components/ExampleNotice';
import { Loading } from '../components/Recovery';
import { usePlan } from '../data/queries';
import { t } from '../i18n/uk';

export function PlanHistory() {
  const plan = usePlan();
  if (!plan) return <Loading />;

  return (
    <section className="space-y-4 pt-4">
      <header className="protocol-scene-header">
        <h1 className="text-2xl font-semibold">{t.versions.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.versions.hint}</p>
      </header>
      <ExampleNotice plan={plan} />
      <PlanVersions current={plan} />
    </section>
  );
}
