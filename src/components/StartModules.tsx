import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MODULE_IDS, type ModuleFlags } from '../domain/features';
import { starterModules } from '../domain/moduleStart';
import { modulePreferences, type ModuleEvent } from '../domain/modulePreferences';
import type { Plan } from '../domain/types';
import { Sheet } from './Sheet';
import { t } from '../i18n/uk';

export function StartModules({ plan, fresh, events, choices, weightChoice, onChoices, onWeight }: {
  plan: Plan; fresh: boolean; events: readonly ModuleEvent[]; choices: Partial<ModuleFlags>; weightChoice?: boolean;
  onChoices: (choices: Partial<ModuleFlags>) => void; onWeight: (on: boolean) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const initial = starterModules(plan), current = modulePreferences(events);
  const modules = fresh ? { ...initial.modules, ...choices } : current.modules;
  const weight = fresh ? weightChoice ?? (initial.weight || modules.wellbeing) : current.overrides['wellbeing.weight'] ?? current.modules.wellbeing;
  const labels: string[] = MODULE_IDS.filter((key) => modules[key]).map((key) => t.modules.names[key]);
  if (weight) labels.push(t.progress.weight);
  return <div className="space-y-3">
    <p className="font-medium">{t.startFlow.summary}</p><ul className="list-disc pl-5">{labels.map((label) => <li key={label}>{label}</li>)}</ul>
    <p className="text-sm text-muted">{t.startFlow.always}</p>
    {fresh ? <><p className="text-sm text-muted">{t.startFlow.progress}</p>
      <details className="rounded-2xl border border-line bg-surface p-3"><summary className="min-h-tap cursor-pointer font-medium">{t.startFlow.choose}</summary>
        {MODULE_IDS.map((key) => <label key={key} className="flex min-h-tap items-center gap-3"><input type="checkbox" checked={modules[key]} onChange={(e) => {
          if (key === 'meds' && !e.target.checked && initial.modules.meds) setConfirm(true);
          else onChoices({ ...choices, [key]: e.target.checked });
        }} className="h-5 w-5 accent-[rgb(var(--accent))]" /><span>{t.modules.names[key]}</span></label>)}
        <label className="flex min-h-tap items-center gap-3"><input type="checkbox" checked={weight} onChange={(e) => onWeight(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--accent))]" /><span>{t.modules.weight}</span></label>
      </details></> : <p className="text-sm text-muted">{t.startFlow.keep} <Link to="/modules" className="text-accent underline">{t.modules.title}</Link></p>}
    {confirm && <Sheet title={t.modules.confirmMeds} onClose={() => setConfirm(false)}><div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => { onChoices({ ...choices, meds: false }); setConfirm(false); }} className="min-h-tap rounded-xl bg-warn px-3 text-surface">{t.modules.off}</button>
      <button type="button" onClick={() => setConfirm(false)} className="min-h-tap rounded-xl border border-line px-3">{t.modules.cancel}</button></div></Sheet>}
  </div>;
}
