import { useState } from 'react';
import { useFeatures } from '../app/features';
import { db } from '../data/db';
import { useModuleEvents } from '../data/queries';
import { acceptPlanModules } from '../data/moduleStart';
import { planModuleSuggestions, type PlanModule } from '../domain/moduleStart';
import type { Plan } from '../domain/types';
import { t } from '../i18n/uk';

/** A visit review is distinct from gradual-start offers: unchecked, no automatic choice, no offer/pilot counters. */
export function PlanModuleReview({ before, after, onClose }: { before: Plan; after: Plan; onClose: () => void }) {
  const { enabled, context } = useFeatures();
  const events = useModuleEvents();
  const [picked, setPicked] = useState<PlanModule[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!enabled || context.demo || !events) return null;
  const candidates = planModuleSuggestions(before, after, events);
  if (!candidates.length) return null;
  const apply = async () => {
    setBusy(true); setError('');
    try { await acceptPlanModules(db, picked.filter((key) => candidates.includes(key))); onClose(); }
    catch { setError(t.startFlow.error); } finally { setBusy(false); }
  };
  return <section aria-label={t.startFlow.review} className="space-y-2 rounded-2xl border border-accent/40 bg-surface p-3">
    <h2 className="font-semibold">{t.startFlow.review}</h2><p className="text-sm text-muted">{t.startFlow.reviewHint}</p>
    {candidates.map((key) => <label key={key} className="flex min-h-tap items-center gap-3">
      <input type="checkbox" checked={picked.includes(key)} disabled={busy} onChange={(e) => setPicked((all) => e.target.checked ? [...all, key] : all.filter((k) => k !== key))} className="h-5 w-5 accent-[rgb(var(--accent))]" />
      <span>{t.startFlow.enable(key === 'weight' ? t.progress.weight : t.modules.names[key])}</span></label>)}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !picked.some((key) => candidates.includes(key))} onClick={() => void apply()} className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">{t.startFlow.apply}</button>
      <button type="button" disabled={busy} onClick={onClose} className="min-h-tap rounded-xl border border-line px-3">{t.startFlow.decline}</button></div>
    {error && <p role="alert" className="text-sm text-warn">{error}</p>}
  </section>;
}
