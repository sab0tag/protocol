import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PlanVersions } from '../components/PlanVersions';
import { Loading } from '../components/Recovery';
import { usePlan } from '../data/queries';
import { t } from '../i18n/uk';

export function PlanHistory() {
  const plan = usePlan();
  if (!plan) return <Loading />;

  return (
    <section className="space-y-4 pt-4">
      <Link to="/plan" className="inline-flex min-h-tap items-center gap-1 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />{t.plan.title}
      </Link>
      <header className="protocol-scene-header">
        <h1 className="text-2xl font-semibold">{t.versions.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.versions.hint}</p>
      </header>
      <PlanVersions current={plan} />
    </section>
  );
}
