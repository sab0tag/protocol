// D179 (task 7, step 5): «Тренування» when the plan has a rehabilitation complex. The complex as the doctor gave it — the
// current stage's exercises with their doses and notes; «Зробив(ла)» → pain 0–10 in one tap and swelling yes / no → one
// record. The next stage is asked about when its date comes and taken only after «Так». Nothing here composes, adds
// sets or weight, or suggests a harder exercise.
import { format } from 'date-fns';
import { useState } from 'react';
import { SceneHeader } from '../components/SceneHeader';
import { saved } from '../components/Toast';
import { db, type PlanRow } from '../data/db';
import { useAllEntries } from '../data/queries';
import { atLocal, newId, todayISO } from '../domain/dates';
import { allowStage, currentStage, notYetStage, sessionsOn, stageToAsk } from '../domain/rehab';
import type { DayEntry } from '../domain/types';
import { t } from '../i18n/uk';

const R = t.rehab;

export function RehabSession({ plan }: { plan: PlanRow }) {
  const c = plan.rehab!;
  const today = todayISO();
  const entries = useAllEntries() ?? [];
  const stage = currentStage(c), ask = stageToAsk(c, today);
  const done = sessionsOn(entries, today).length;
  const [step, setStep] = useState<'idle' | 'pain'>('idle');
  const [pain, setPain] = useState<number | null>(null), [swelling, setSwelling] = useState<boolean | null>(null);
  const setComplex = (next: typeof c) => saved(db.plan.update('main', { rehab: next }), t.toast.plan);
  const record = async () => {
    if (pain === null || swelling === null) return;
    const e: DayEntry = { id: newId(), at: atLocal(today, format(new Date(), 'HH:mm')), kind: 'workout', status: 'done', title: R.title,
      rehab: { stageId: stage.id, pain, swelling } };
    await saved(db.entries.add(e), R.saved(done + 1, c.perDay), () => db.entries.delete(e.id));
    setStep('idle'); setPain(null); setSwelling(null);
  };
  return (
    <section className="space-y-4 pt-4" data-testid="rehab">
      <SceneHeader title={R.title} description={R.intro} />
      <p className="text-sm font-semibold" data-testid="rehab-count">{R.count(done, c.perDay)}</p>
      {ask && <div role="group" aria-label={R.askTitle} className="protocol-card space-y-2 p-4">
        <p className="font-medium">{R.ask(ask.title)}</p>
        <p className="text-sm text-muted">{R.askWhy}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void setComplex(allowStage(c, ask.id))} className="min-h-tap rounded-full bg-accent px-4 font-semibold text-on-accent">{R.yes}</button>
          <button type="button" onClick={() => void setComplex(notYetStage(c, ask.id, today))} className="min-h-tap rounded-full border-2 border-line px-4 font-semibold">{R.notYet}</button>
        </div>
      </div>}
      <article className="protocol-card space-y-2 p-4">
        <h2 className="text-lg font-semibold">{stage.title}</h2>
        <ol className="space-y-2">
          {stage.exercises.map((x) => <li key={x.id} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
            <p className="font-medium">{x.name}{x.dose && <span className="font-normal"> · {x.dose}</span>}</p>
            {x.note && <p className="text-sm text-muted">{x.note}</p>}
          </li>)}
        </ol>
        <p className="text-sm text-muted">{R.source(c.source)}</p>
      </article>
      {step === 'idle' ? <button type="button" onClick={() => setStep('pain')} className="min-h-tap w-full rounded-xl bg-accent px-4 font-semibold text-on-accent">{R.did}</button>
        : <div className="protocol-card space-y-3 p-4">
          <fieldset><legend className="font-medium">{R.pain}</legend>
            <div className="mt-2 grid grid-cols-6 gap-1">{Array.from({ length: 11 }, (_, n) => (
              <button key={n} type="button" aria-pressed={pain === n} onClick={() => setPain(n)}
                className={`min-h-tap rounded-xl border-2 font-semibold tabular ${pain === n ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}>{n}</button>))}</div>
            <p className="mt-1 text-xs text-muted">{R.painScale}</p></fieldset>
          <fieldset><legend className="font-medium">{R.swelling}</legend>
            <div className="mt-2 flex gap-2">{([true, false] as const).map((v) => (
              <button key={String(v)} type="button" aria-pressed={swelling === v} onClick={() => setSwelling(v)}
                className={`min-h-tap flex-1 rounded-xl border-2 font-semibold ${swelling === v ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}>{v ? R.yesSwelling : R.noSwelling}</button>))}</div></fieldset>
          <button type="button" disabled={pain === null || swelling === null} onClick={() => void record()}
            className="min-h-tap w-full rounded-xl bg-accent px-4 font-semibold text-on-accent disabled:opacity-40">{R.save}</button>
        </div>}
      <p className="text-sm text-muted">{R.never}</p>
    </section>
  );
}
