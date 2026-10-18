// D73: a plan that came from the example says so wherever it acts — on «День» and «План» — with one way out.
import { useNavigate } from 'react-router-dom';
import { db, inDemo, leaveDemo, type PlanRow } from '../data/db';
import { restoreDemo, takeDemo } from '../data/demoStore';
import { hasExample, withoutExample } from '../data/seed.example';
import { t } from '../i18n/uk';
import { saved } from './Toast';

export function ExampleNotice({ plan }: { plan: PlanRow | undefined }) {
  const navigate = useNavigate();
  if (inDemo()) return ( // D98: the example's own database — leaving it opens the person's own, untouched
    <div role="status" className="mb-3 space-y-2 rounded-2xl border border-warn/30 bg-warn-bg p-3 text-sm text-warn">
      <p>{t.example.demoNotice}</p>
      <button type="button" onClick={() => void leaveDemo()} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{t.example.leave}</button>
    </div>
  );
  if (!plan || !hasExample(plan)) return null; // an example put into the own plan by an older version — taken out item by item
  const start = async () => {
    const before = { constraints: plan.constraints, prescriptions: plan.prescriptions, targets: plan.targets, modes: plan.modes };
    let week: Awaited<ReturnType<typeof takeDemo>> | undefined;
    await saved(async () => { await db.plan.update('main', withoutExample(plan)); week = await takeDemo(); }, t.example.cleared,
      async () => { await db.plan.update('main', before); if (week) await restoreDemo(week); });
    navigate('/welcome');
  };
  return (
    <div role="status" className="mb-3 space-y-2 rounded-2xl border border-warn/30 bg-warn-bg p-3 text-sm text-warn">
      <p>{t.example.notice}</p>
      <button type="button" onClick={() => void start()} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{t.example.start}</button>
    </div>
  );
}
