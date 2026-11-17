// Keep example data visibly separate wherever it is shown or edited.
import { useNavigate } from 'react-router-dom';
import { db, inDemo, leaveDemo, type PlanRow } from '../data/db';
import { restoreDemo, takeDemo } from '../data/demoStore';
import { hasExample, withoutExample } from '../data/seed.example';
import { t } from '../i18n/uk';
import { saved } from './Toast';

export function ExampleNotice({ plan }: { plan: PlanRow | undefined }) {
  const navigate = useNavigate();
  if (inDemo()) return null; // D160: the example is said once for the whole app — `ExampleStrip` in the shell
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
      <button type="button" onClick={() => void start()} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface print:hidden">{t.example.start}</button>
    </div>
  );
}

/** D98, D160: in the example's own database one thin line on top of every screen — «Приклад · Вийти»; leaving opens the
 *  person's own data, untouched. Replaces the three-line notice each screen used to carry. */
export function ExampleStrip() {
  if (!inDemo()) return null;
  return <p role="status" title={t.example.demoNotice} className="protocol-example-strip print:hidden">
    <span className="font-semibold">{t.example.strip}</span><span aria-hidden>·</span><span>{t.example.stripKept}</span><span aria-hidden>·</span>
    <button type="button" onClick={() => void leaveDemo()} className="font-semibold underline underline-offset-2">{t.example.exit}</button>
  </p>;
}
