import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFeatures } from '../app/features';
import { Sheet } from '../components/Sheet';
import { Loading } from '../components/Recovery';
import { db } from '../data/db';
import { enableAllModules, setModuleEnabled, setWeightEnabled } from '../data/modulePreferences';
import { useModuleEvents, usePlan } from '../data/queries';
import { MODULE_IDS, type ModuleId } from '../domain/features';
import { t } from '../i18n/uk';
import { currentKeys, requestSync } from '../sync/runner';
import { reconcileReminderPolicy } from '../sync/push';
import { policyFromEvents } from '../../server/src/reminderPolicy';

const L = t.modules;
export function Modules() {
  const { context, can, enabled } = useFeatures();
  const plan = usePlan();
  const events = useModuleEvents();
  const meta = useLiveQuery(() => db.meta.get('sync'), []);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const run = async (write: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await write(); setMessage(L.saved);
      const keys = currentKeys();
      if (keys) { requestSync(); void reconcileReminderPolicy(keys).catch(() => undefined); }
    } catch { setError(L.error); } finally { setBusy(false); }
  };
  const toggle = (module: ModuleId, on: boolean) => {
    if (module === 'meds' && !on && plan?.prescriptions.some((p) => p.kind === 'medication' || p.kind === 'supplement')) { setConfirm(true); return; }
    void run(() => setModuleEnabled(db, module, on));
  };
  if (!enabled) return <section className="space-y-3 pt-6"><h1 className="text-2xl font-semibold">{L.title}</h1><p>{L.preparing}</p><Link to="/" className="text-accent underline">{t.nav.day}</Link></section>;
  if (!plan || !events) return <Loading />;
  const signature = JSON.stringify(policyFromEvents(events ?? []));
  const acked = meta?.reminderPolicyState === 'synced' && meta.reminderPolicyAck === signature;
  return <section className="space-y-4 pt-6">
    <h1 className="text-2xl font-semibold">{L.title}</h1>
    <p>{L.intro}</p><p className="text-sm text-muted">{L.kept}</p>
    {context.demo && <p role="status" className="text-sm text-muted">{L.demo}</p>}
    <fieldset disabled={busy || context.demo} className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      <legend className="sr-only">{L.title}</legend>
      {MODULE_IDS.map((module) => <label key={module} className="flex min-h-tap items-center gap-3 p-3">
        <input type="checkbox" role="switch" aria-label={L.names[module]} checked={!!context.demo || context.modules[module]} onChange={(e) => toggle(module, e.target.checked)} className="h-5 w-5 shrink-0 accent-[rgb(var(--accent))]" />
        <span><span className="block font-medium">{L.names[module]}</span><span className="block text-sm text-muted">{L.descriptions[module]}</span></span>
      </label>)}
    </fieldset>
    <label className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-3">
      <input type="checkbox" checked={can('wellbeing.weight')} disabled={busy || context.demo} onChange={(e) => void run(() => setWeightEnabled(db, e.target.checked))}
        className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--accent))]" aria-label={L.weight} />
      <span><span className="block font-medium">{L.weight}</span><span className="block text-sm text-muted">{L.weightHint}</span></span>
    </label>
    <button type="button" disabled={busy || context.demo} onClick={() => void run(() => enableAllModules(db))} className="min-h-tap rounded-xl border border-accent px-4 font-medium text-accent disabled:opacity-40">{L.all}</button>
    {!context.demo && <p role="status" className="text-sm text-muted">{meta ? acked ? L.synced : L.pending : L.local}</p>}
    {message && <p role="status" className="text-sm text-accent">{message}</p>}{error && <p role="alert" className="text-sm text-warn">{error}</p>}
    {confirm && <Sheet title={L.confirmMeds} onClose={() => setConfirm(false)}>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => { setConfirm(false); void run(() => setModuleEnabled(db, 'meds', false)); }} className="min-h-tap rounded-xl bg-warn px-4 font-medium text-surface">{L.off}</button>
        <button type="button" onClick={() => setConfirm(false)} className="min-h-tap rounded-xl border border-line px-4">{L.cancel}</button></div>
    </Sheet>}
  </section>;
}
