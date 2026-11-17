import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/Recovery';
import { PlanScan } from '../components/PlanScan';
import { ExampleNotice } from '../components/ExampleNotice';
import { usePlan } from '../data/queries';
import { t } from '../i18n/uk';

export function PlanScanScreen() {
  const plan = usePlan();
  const navigate = useNavigate();
  if (!plan) return <Loading />;

  return (
    <section className="space-y-4 pt-4">
      <header className="protocol-scene-header">
        <h1 className="text-2xl font-semibold">{t.conclusion.button}</h1>
        <p className="mt-1 text-sm text-muted">{t.conclusion.hint}</p>
      </header>
      <ExampleNotice plan={plan} />
      <PlanScan plan={plan} onDone={() => navigate('/plan')} />
    </section>
  );
}
