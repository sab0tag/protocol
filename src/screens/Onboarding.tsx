import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, type PlanRow } from '../data/db';
import { usePlan } from '../data/queries';
import { newId, todayISO } from '../domain/dates';
import type { Constraint, ConstraintTag, Prescription, Targets } from '../domain/types';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';
import { TargetFields } from './Plan';

const L = t.welcome;
const P = t.plan;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const TAGS: ConstraintTag[] = ['oxalate', 'gallbladder', 'lactose', 'glycemic', 'iron', 'sodium'];
const EXAMPLE = 'Приклад';

/** Onboarding (SPEC.md §5.9): about me → what the doctor said → targets. Nothing is chosen for the user:
 *  the example plan's items are not pre-ticked; every item is confirmed by a tick or typed in. */
export function Onboarding() {
  const plan = usePlan();
  if (!plan) return null;
  return <Steps plan={plan} />;
}

function Steps({ plan }: { plan: PlanRow }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState(plan.profile?.heightCm ? String(plan.profile.heightCm) : '');
  const own = (c: Constraint) => c.source !== EXAMPLE;
  const [chosen, setChosen] = useState<Record<string, Constraint | undefined>>(() =>
    Object.fromEntries(plan.constraints.filter((c) => own(c) && c.active).map((c) => [c.tag, c])));
  const [rx, setRx] = useState<Prescription[]>(plan.prescriptions.filter((p) => p.source !== EXAMPLE));
  const [targets, setTargets] = useState<Partial<Targets>>(plan.targets);

  const done = async (skip: boolean) => {
    const today = todayISO();
    if (skip) {
      await db.plan.update('main', { onboardedAt: today });
    } else {
      const kg = Number(weight.replace(',', '.'));
      if (kg > 0) await db.weights.put({ date: today, kg });
      const cm = Number(height);
      const constraints = [...plan.constraints.filter((c) => own(c) && c.tag === 'custom'),
        ...Object.values(chosen).filter((c): c is Constraint => !!c)];
      await db.plan.update('main', {
        constraints, prescriptions: rx.filter((p) => p.title.trim()), targets: Object.fromEntries(
          Object.entries(targets).filter(([, v]) => v !== undefined)) as Targets,
        modes: plan.modes.filter((m) => m.id !== 'm-ogtt'), // the example's mode goes with the example
        ...(cm > 0 ? { profile: { heightCm: cm } } : {}), onboardedAt: today,
      });
    }
    useUi.getState().setOnboarded();
    navigate('/', { replace: true });
  };

  const toggle = (tag: ConstraintTag, on: boolean) => setChosen((x) => ({ ...x,
    [tag]: on ? x[tag] ?? { id: newId(), tag, title: P.tags[tag], reason: '', source: '', active: true } : undefined }));
  const setC = (tag: ConstraintTag, patch: Partial<Constraint>) => setChosen((x) => ({ ...x, [tag]: { ...x[tag]!, ...patch } }));

  return (
    <section className="space-y-4 pt-6">
      <div>
        <p className="text-sm text-muted">{L.step(step)}</p>
        <h1 className="text-2xl font-semibold">{[L.s1, L.s2, L.s3][step - 1]}</h1>
      </div>

      {step === 1 && (
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-surface p-3">
          <label className="block"><span className="text-sm text-muted">{L.weight}</span>
            <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className={field} /></label>
          <label className="block"><span className="text-sm text-muted">{L.height}</span>
            <input inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} className={field} /></label>
        </div>
      )}

      {step === 2 && (
        <>
          <p className="text-sm text-muted">{L.constraintsHint}</p>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {TAGS.map((tag) => {
              const c = chosen[tag];
              return (
                <li key={tag} className="px-3 py-2">
                  <label className="flex min-h-tap items-center gap-3">
                    <input type="checkbox" checked={!!c} onChange={(e) => toggle(tag, e.target.checked)} className="h-5 w-5 accent-[rgb(var(--accent))]" />
                    <span className="font-medium">{P.tags[tag]}</span>
                  </label>
                  {c && (
                    <div className="grid gap-2 pb-2 pl-8 sm:grid-cols-2">
                      <label className="block"><span className="text-sm text-muted">{P.reason}</span>
                        <input value={c.reason} onChange={(e) => setC(tag, { reason: e.target.value })} className={field} /></label>
                      <label className="block"><span className="text-sm text-muted">{P.source}</span>
                        <input value={c.source} onChange={(e) => setC(tag, { source: e.target.value })} placeholder="Уролог, 2025" className={field} /></label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-muted">{L.prescriptionsHint}</p>
          <ul className="space-y-2">
            {rx.map((p, i) => (
              <li key={p.id} className="grid grid-cols-[1fr_5.5rem_auto] items-end gap-2 rounded-2xl border border-line bg-surface p-2">
                <label className="block"><span className="text-sm text-muted">{P.title_}</span>
                  <input value={p.title} onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className={field} /></label>
                <label className="block"><span className="text-sm text-muted">{t.simple.time}</span>
                  <input type="time" value={p.schedule?.times[0] ?? ''} className={field}
                    onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, schedule: e.target.value ? { times: [e.target.value] } : undefined } : x)))} /></label>
                <button type="button" onClick={() => setRx(rx.filter((_, j) => j !== i))} aria-label={`${P.delete}: ${p.title}`}
                  className="flex min-h-tap min-w-tap items-center justify-center text-warn"><Trash2 size={18} /></button>
                <label className="col-span-3 block"><span className="text-sm text-muted">{P.dose}</span>
                  <input value={p.dose ?? ''} onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, dose: e.target.value || undefined } : x)))} className={field} /></label>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setRx([...rx, { id: newId(), kind: 'medication', title: '', source: '' }])}
            className="flex min-h-tap items-center gap-2 rounded-xl border border-accent px-3 text-accent"><Plus size={18} />{L.addPrescription}</button>
        </>
      )}

      {step === 3 && (
        <>
          <p className="text-sm text-muted">{L.targetsHint}</p>
          <div className="rounded-2xl border border-line bg-surface p-3"><TargetFields value={targets} onChange={setTargets} /></div>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {step < 3 ? <button type="button" onClick={() => setStep(step + 1)} className="min-h-tap flex-1 rounded-xl bg-accent px-4 font-medium text-surface">{L.next}</button>
          : <button type="button" onClick={() => void done(false)} className="min-h-tap flex-1 rounded-xl bg-accent px-4 font-medium text-surface">{L.finish}</button>}
        {step > 1 && <button type="button" onClick={() => setStep(step - 1)} className="min-h-tap rounded-xl border border-line px-4">{L.back}</button>}
      </div>
      <button type="button" onClick={() => void done(true)} className="min-h-tap text-muted underline">{L.skip}</button>
      {step === 1 && <button type="button" onClick={() => navigate('/sync')} className="block min-h-tap text-accent underline">{t.sync.welcome}</button>}
      <p className="text-sm text-muted">{P.disclaimer}</p>
    </section>
  );
}
