// D73: a plan that came from the example says so wherever it acts — on «День» and «План» — with one way out.
import { useNavigate } from 'react-router-dom';
import { db, type PlanRow } from '../data/db';
import { hasExample, withoutExample } from '../data/seed.example';
import { t } from '../i18n/uk';
import { saved } from './Toast';

export function ExampleNotice({ plan }: { plan: PlanRow | undefined }) {
  const navigate = useNavigate();
  if (!plan || !hasExample(plan)) return null;
  const start = async () => {
    const before = { constraints: plan.constraints, prescriptions: plan.prescriptions, targets: plan.targets, modes: plan.modes };
    await saved(db.plan.update('main', withoutExample(plan)), t.example.cleared, () => db.plan.update('main', before));
    navigate('/welcome');
  };
  return (
    <div role="status" className="mb-3 space-y-2 rounded-2xl border border-warn/30 bg-warn-bg p-3 text-sm text-warn">
      <p>{t.example.notice}</p>
      <button type="button" onClick={() => void start()} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{t.example.start}</button>
    </div>
  );
}
