// D183 («Очередь агента», task 8): «Ціль щодо ваги» — the person's own goal, counted by the code. Stop conditions first: with
// any of them no number at all, only «спершу з лікарем» (or, for words of distress about food, a soft word about a specialist).
// Otherwise the numbers with why, the honest price of a slow pace, and «Зберегти як мою ціль» — never a doctor's number,
// which always wins. Two weeks later with a new weight — «оновити?»; a plateau of three weeks — the record and the activity first.
import { kcalFloor, normsDraft } from '../domain/norms';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SceneHeader } from '../components/SceneHeader';
import { saved } from '../components/Toast';
import { db } from '../data/db';
import { usePlan, useWeights } from '../data/queries';
import { todayISO } from '../domain/dates';
import type { GoalInput, OwnGoal } from '../domain/types';
import { explain, goalPlan, plateau, recountDue, stopReasons, type StopReason } from '../domain/weightGoal';
import { t } from '../i18n/uk';

const G = t.goal;
const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() && Number.isFinite(n) ? n : undefined; };

export function WeightGoal() {
  const plan = usePlan(), weights = useWeights();
  const today = todayISO();
  const latest = useLiveQuery(async () => (await db.weights.orderBy('date').last())?.kg, []);
  const own = plan?.ownGoal;
  const [f, setF] = useState<Record<string, string>>({});
  const [deficit, setDeficit] = useState(own?.input.deficit ?? 600);
  if (!plan || weights === undefined) return null;
  const v = (k: keyof GoalInput | 'note', fallback?: number | string) => f[k] ?? (fallback === undefined ? '' : String(fallback));
  const input: Partial<GoalInput> = {
    sex: (v('sex', own?.input.sex ?? 'male') as GoalInput['sex']), age: num(v('age', own?.input.age)), heightCm: num(v('heightCm', own?.input.heightCm ?? plan.profile?.heightCm)),
    weightKg: num(v('weightKg', latest ?? own?.input.weightKg)), goalKg: num(v('goalKg', own?.input.goalKg)),
    stepsPerDay: num(v('stepsPerDay', own?.input.stepsPerDay)), trainingMinPerWeek: num(v('trainingMinPerWeek', own?.input.trainingMinPerWeek)),
    pregnant: v('pregnant', own?.input.pregnant ? '1' : '') === '1', deficit,
  };
  const complete = !!(input.age && input.heightCm && input.weightKg && input.goalKg && input.goalKg < input.weightKg);
  const stops = stopReasons(plan, input, v('note'));
  const g = complete && !stops.length ? goalPlan(input as GoalInput, plan, today) : null;
  const doctorKcal = plan.targets.kcal;
  const due = own ? recountDue(own, weights, today) : null;
  const flat = own && plateau(weights.filter((w) => w.date >= own.setAt));
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    if (!g) return;
    const goal: OwnGoal = { input: input as GoalInput, kcal: g.kcal, proteinG: g.proteinG, perWeekKg: g.perWeekKg, goalDate: g.goalDate, setAt: today };
    return saved(db.plan.update('main', { ownGoal: goal }), G.saved);
  };
  const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
  return (
    <section className="space-y-4 pt-4" data-testid="weight-goal">
      <SceneHeader title={G.title} description={G.intro} />
      {own && <div className="protocol-card space-y-1 p-3 text-sm" data-testid="own-goal">
        <p className="font-semibold">{G.current(own.input.goalKg, own.kcal, own.proteinG, own.perWeekKg)}</p>
        <p className="text-muted">{G.notDoctor} · {G.setOn(own.setAt.slice(8, 10) + '.' + own.setAt.slice(5, 7))}</p>
        {due && <p role="note">{G.recount(due.kg)} <button type="button" className="min-h-tap underline" onClick={() => setF({ ...f, weightKg: String(due.kg) })}>{G.recountYes}</button></p>}
        {flat && <p role="note" data-testid="plateau">{G.plateau(kcalFloor(own.input.sex))}</p>}
        <button type="button" className="min-h-tap underline" onClick={() => void saved(db.plan.update('main', { ownGoal: undefined }), G.removed)}>{G.remove}</button>
      </div>}
      {doctorKcal !== undefined && <p className="protocol-card p-3 text-sm">{G.doctorWins(doctorKcal)}</p>}
      <form className="protocol-card grid grid-cols-2 gap-3 p-3 text-sm" onSubmit={(e) => e.preventDefault()}>
        <label className="col-span-2">{G.sex}<select className={field} value={v('sex', input.sex)} onChange={set('sex')}><option value="male">{G.male}</option><option value="female">{G.female}</option></select></label>
        <label>{G.age}<input className={field} inputMode="numeric" value={v('age', own?.input.age)} onChange={set('age')} /></label>
        <label>{G.height}<input className={field} inputMode="numeric" value={v('heightCm', own?.input.heightCm ?? plan.profile?.heightCm)} onChange={set('heightCm')} /></label>
        <label>{G.weight}<input className={field} inputMode="decimal" value={v('weightKg', latest ?? own?.input.weightKg)} onChange={set('weightKg')} /></label>
        <label>{G.goalKg}<input className={field} inputMode="decimal" value={v('goalKg', own?.input.goalKg)} onChange={set('goalKg')} /></label>
        <label>{G.steps}<input className={field} inputMode="numeric" placeholder={G.stepsPh} value={v('stepsPerDay', own?.input.stepsPerDay)} onChange={set('stepsPerDay')} /></label>
        <label>{G.training}<input className={field} inputMode="numeric" placeholder="0" value={v('trainingMinPerWeek', own?.input.trainingMinPerWeek)} onChange={set('trainingMinPerWeek')} /></label>
        {input.sex === 'female' && <label className="col-span-2 flex min-h-tap items-center gap-2"><input type="checkbox" checked={input.pregnant} onChange={(e) => setF({ ...f, pregnant: e.target.checked ? '1' : '' })} />{G.pregnant}</label>}
        <label className="col-span-2">{G.note}<textarea className={`${field} py-2`} rows={2} value={v('note')} onChange={set('note')} /></label>
      </form>
      {stops.length > 0 ? <Stop reasons={stops} /> : g && <div className="protocol-card space-y-2 p-4" data-testid="goal-result">
        <p className="text-2xl font-semibold tabular">{G.kcal(g.kcal)}</p>
        <ul className="space-y-1 text-sm">{explain(g).map((line) => <li key={line}>{line}</li>)}</ul>
        <fieldset><legend className="text-sm font-medium">{G.deficit}</legend>
          <div className="mt-1 flex flex-wrap gap-2">{[750, 600, 500, 300].map((d) => (
            <button key={d} type="button" aria-pressed={deficit === d} onClick={() => setDeficit(d)}
              className={`min-h-tap rounded-full border-2 px-3 font-semibold ${deficit === d ? 'border-accent text-accent' : 'border-line'}`}>{d < 500 ? G.slowChoice(d) : `−${d}`}</button>))}</div></fieldset>
        <p className="text-xs text-muted">{G.notDoctor}.{normsDraft('deficit', 'kcalFloor', 'pace', 'firstStage', 'protein', 'stopMeds') ? ` ${G.draft}` : ''}</p>{/* D196/D197 */}
        <button type="button" onClick={() => void save()} className="min-h-tap w-full rounded-xl bg-accent px-4 font-semibold text-on-accent">{G.save}</button>
      </div>}
      {!complete && !stops.length && <p className="text-sm text-muted">{G.fill}</p>}
    </section>
  );
}

function Stop({ reasons }: { reasons: StopReason[] }) {
  if (reasons.includes('eating')) return <div role="note" className="protocol-card space-y-2 p-4" data-testid="goal-stop"><p className="font-semibold">{G.eatingTitle}</p><p className="text-sm">{G.eating}</p></div>;
  return (
    <div role="note" className="protocol-card space-y-2 p-4" data-testid="goal-stop">
      <p className="text-lg font-semibold">{G.stopTitle}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">{reasons.map((r) => <li key={r}>{G.stops[r]}</li>)}</ul>
      <p className="text-sm text-muted">{G.stopWhy}</p>
      <Link to="/report" className="inline-flex min-h-tap items-center underline">{G.toReport}</Link>
    </div>
  );
}
