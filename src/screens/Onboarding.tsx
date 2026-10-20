import { Plus, Trash2 } from 'lucide-react';
import { Loading } from '../components/Recovery';
import { toast } from '../components/Toast';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, enterDemo, type PlanRow } from '../data/db';
import { PlanScan } from '../components/PlanScan';
import { DietPicker } from '../components/DietPicker';
import { dietOf, fillEmptyTargets, type DietPreset } from '../domain/diets';
import { EXAMPLE_SOURCE, withoutExample } from '../data/seed.example';
import { usePlan } from '../data/queries';
import { newId, sinceNow, todayISO } from '../domain/dates';
import type { Constraint, ConstraintTag, Prescription, Targets } from '../domain/types';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';
import { TargetFields } from './Plan';

const L = t.welcome;
const P = t.plan;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const TAGS: ConstraintTag[] = ['oxalate', 'gallbladder', 'lactose', 'glycemic', 'iron', 'sodium'];

/** Onboarding (SPEC.md §5.9): about me → what the doctor said → targets. Nothing is chosen for the user:
 *  the example plan's items are not pre-ticked; every item is confirmed by a tick or typed in. Skipping leaves the plan
 *  empty; the example is opened only by its own button, on a plan that has nothing of the person's yet (D73). */
export function Onboarding() {
  const plan = usePlan();
  const [read, setRead] = useState(0); // D80: a conclusion put into the plan — the steps start again from it, on step 2
  if (!plan) return <Loading />;
  // D113 (step 0, part 5): the first screen is the doctor's paper; typing the plan by hand is one tap away
  return <Steps key={read} plan={plan} start={read ? 2 : 0} onScanned={() => setRead((n) => n + 1)} />;
}

function Steps({ plan, start, onScanned }: { plan: PlanRow; start: number; onScanned: () => void }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(start);
  const [weight, setWeight] = useState('');
  const own = (c: Constraint) => c.source !== EXAMPLE_SOURCE;
  const [chosen, setChosen] = useState<Record<string, Constraint | undefined>>(() =>
    Object.fromEntries(plan.constraints.filter((c) => own(c) && c.active).map((c) => [c.tag, c])));
  const [rx, setRx] = useState<Prescription[]>(plan.prescriptions.filter((p) => p.source !== EXAMPLE_SOURCE));
  const [targets, setTargets] = useState<Partial<Targets>>(() => withoutExample(plan).targets);
  // D90: a diet of Наказ №931 — its norms go into the empty targets only if asked (and come out again if unticked)
  const [fill, setFill] = useState<Partial<Targets> | null>(null);
  const pickDiet = (d: DietPreset) => setChosen((x) => ({ ...x, diet: { id: x.diet?.id ?? newId(), tag: 'diet', diet: d.code, title: `${d.code} — ${d.name}`,
    reason: '', source: 'Наказ МОЗ №931', active: true } }));
  const fillDiet = (on: boolean) => {
    const d = dietOf(chosen.diet?.diet);
    if (on && d) { setFill(targets); setTargets(fillEmptyTargets(targets as Targets, d)); } else if (fill) { setTargets(fill); setFill(null); }
  };

  const done = async (skip: boolean) => {
    const today = todayISO();
    if (skip) {
      await db.plan.update('main', { onboardedAt: today });
    } else {
      const kg = Number(weight.replace(',', '.'));
      if (kg > 0) await db.weights.put({ date: today, kg });
      const constraints = [...plan.constraints.filter((c) => own(c) && c.tag === 'custom'),
        ...Object.values(chosen).filter((c): c is Constraint => !!c)];
      await db.plan.update('main', {
        constraints, prescriptions: rx.filter((p) => p.title.trim()), targets: Object.fromEntries(
          Object.entries(targets).filter(([, v]) => v !== undefined)) as Targets,
        modes: withoutExample(plan).modes, // the example's mode goes with the example
        onboardedAt: today,
      });
    }
    useUi.getState().setOnboarded();
    if (!skip) toast(t.toast.plan);
    navigate('/', { replace: true });
  };

  // D100: the plan does not start with a medicine that has no dose or no time — the same rule as the medicine form
  const rxBlocked = rx.filter((p) => p.title.trim()).map((p) => (!p.dose?.trim() ? `${p.title}: ${P.needDose}` : !p.schedule?.times.length && !p.asNeeded ? `${p.title}: ${P.needTime}` : '')).find(Boolean);
  const toggle = (tag: ConstraintTag, on: boolean) => setChosen((x) => ({ ...x,
    [tag]: on ? x[tag] ?? { id: newId(), tag, title: P.tags[tag], reason: '', source: '', active: true } : undefined }));
  const setC = (tag: ConstraintTag, patch: Partial<Constraint>) => setChosen((x) => ({ ...x, [tag]: { ...x[tag]!, ...patch } }));

  // D113: the paper confirmed and «Почати» pressed — the plan is made; «День» shows its first dose
  const started = async () => {
    await db.plan.update('main', { onboardedAt: todayISO() });
    useUi.getState().setOnboarded();
    navigate('/', { replace: true });
  };

  if (step === 0) return (
    <section className="space-y-4 pt-6">
      <h1 className="text-2xl font-semibold">{L.s0}</h1>
      <p className="text-sm text-muted">{L.s0hint}</p>
      <PlanScan plan={plan} onboarding onDone={() => void started()} />
      <button type="button" onClick={() => setStep(1)} className="min-h-tap w-full rounded-xl border border-accent px-4 font-medium text-accent">{L.manual}</button>
      <div><button type="button" onClick={enterDemo} className="min-h-tap text-accent underline">{L.example}</button>
        <p className="text-sm text-muted">{L.exampleHint}</p></div>
      <button type="button" onClick={() => navigate('/sync')} className="block min-h-tap text-accent underline">{t.sync.welcome}</button>
      <button type="button" onClick={() => void done(true)} className="min-h-tap text-muted underline">{L.skip}</button>
      <p className="text-sm text-muted">{P.disclaimer}</p>
    </section>
  );

  return (
    <section className="space-y-4 pt-6">
      <div>
        <p className="text-sm text-muted">{L.step(step)}</p>
        <h1 className="text-2xl font-semibold">{[L.s1, L.s2, L.s3][step - 1]}</h1>
      </div>

      {step === 1 && <p className="text-sm text-muted">{L.about}</p>}
      {step === 1 && (
        <div className="rounded-2xl border border-line bg-surface p-3">
          <label className="block w-40"><span className="text-sm text-muted">{L.weight}</span>
            <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className={field} /></label>
        </div>
      )}

      {step === 2 && (
        <>
          <PlanScan plan={plan} onDone={onScanned} />
          <details className="rounded-2xl border border-line bg-surface p-3" open={!!chosen.diet}>
            <summary className="min-h-tap cursor-pointer font-medium">{chosen.diet ? chosen.diet.title : L.diet}</summary>
            <div className="mt-2"><DietPicker value={chosen.diet?.diet} onPick={pickDiet} fill={!!fill} onFill={fillDiet} /></div>
          </details>
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
          <button type="button" onClick={() => setRx([...rx, { id: newId(), kind: 'medication', title: '', source: '', ...sinceNow() }])}
            className="flex min-h-tap items-center gap-2 rounded-xl border border-accent px-3 text-accent"><Plus size={18} />{L.addPrescription}</button>
        </>
      )}

      {step === 3 && (
        <>
          <p className="text-sm text-muted">{L.targetsHint}</p>
          <div className="rounded-2xl border border-line bg-surface p-3"><TargetFields value={targets} onChange={setTargets} /></div>
        </>
      )}

      {step === 3 && rxBlocked && <p role="status" className="text-sm text-warn">{rxBlocked}</p>}
      <div className="flex flex-wrap gap-2">
        {step < 3 ? <button type="button" onClick={() => setStep(step + 1)} className="min-h-tap flex-1 rounded-xl bg-accent px-4 font-medium text-surface">{L.next}</button>
          : <button type="button" onClick={() => void done(false)} disabled={!!rxBlocked} className="min-h-tap flex-1 rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">{L.finish}</button>}
        <button type="button" onClick={() => setStep(step - 1)} className="min-h-tap rounded-xl border border-line px-4">{L.back}</button>
      </div>
      <button type="button" onClick={() => void done(true)} className="min-h-tap text-muted underline">{L.skip}</button>
      <p className="text-sm text-muted">{P.disclaimer}</p>
    </section>
  );
}
