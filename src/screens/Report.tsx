import { addDays, format, parseISO } from 'date-fns';
import { ExampleNotice } from '../components/ExampleNotice';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { uk } from 'date-fns/locale';
import { Plus, Printer, Share2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { db } from '../data/db';
import { useAllEntries, useAllWellbeing, useFoods, useLabs, usePlan, useWeights, useWorkouts } from '../data/queries';
import { dateOf, todayISO } from '../domain/dates';
import { buildReport, habitLabel, prnLimitText, reportText, trackingLines, unscoredMedText } from '../domain/report';
import { useObservation } from '../app/observation';
import { count } from '../data/tally';
import { t } from '../i18n/uk';

const L = t.report;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const num = (n: number) => n.toLocaleString('uk-UA', { maximumFractionDigits: 1 });
const dmy = (d: string) => format(parseISO(d), 'd MMMM yyyy', { locale: uk });

/** «Звіт для лікаря» (SPEC.md §5.8): from the last visit to today by default; prints on one page. */
export function Report() {
  const { observation, ready: observationReady } = useObservation();
  const plan = usePlan();
  const entries = useAllEntries();
  const wellbeing = useAllWellbeing();
  const workouts = useWorkouts();
  const weights = useWeights();
  const labs = useLabs();
  const foods = useFoods();
  const today = todayISO();
  const [range, setRange] = useState<{ from?: string; to: string }>({ to: today });
  const [question, setQuestion] = useState('');
  const [shared, setShared] = useState('');
  if (!plan || !entries || !wellbeing || !workouts || !weights || !foods || !labs || !observationReady) return <Loading />;

  const first = [entries[0] && dateOf(entries[0].at), weights[0]?.date].filter(Boolean).sort()[0];
  const from = range.from ?? plan.lastVisit ?? first ?? format(addDays(new Date(), -13), 'yyyy-MM-dd');
  const r = buildReport({ from, to: range.to, plan, entries, workouts, wellbeing, weights, foods, labs, observation });
  const questions = plan.questions ?? [];
  const setQuestions = (q: string[], say: string = t.toast.saved) => saved(db.plan.update('main', { questions: q }), say);

  const share = async () => {
    void count('report'); // D119
    const text = reportText(r, dmy);
    try {
      if (navigator.share) { await navigator.share({ title: L.title, text }); return; }
      await navigator.clipboard.writeText(text); setShared(L.copied);
    } catch { /* the user closed the share sheet */ }
  };

  return (
    <section className="space-y-4 pt-4 print:pt-0">
      <h1 className="text-2xl font-semibold">{L.title}</h1>
      <div className="print:hidden"><ExampleNotice plan={plan} /></div>
      <div className="grid grid-cols-2 gap-3 print:hidden">
        <label className="block"><span className="text-sm text-muted">{L.from}</span>
          <input type="date" value={from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} className={field} /></label>
        <label className="block"><span className="text-sm text-muted">{L.to}</span>
          <input type="date" value={range.to} max={today} onChange={(e) => setRange({ ...range, to: e.target.value })} className={field} /></label>
      </div>
      <p className="hidden print:block">{dmy(r.from)} — {dmy(r.to)} · {L.days(r.days)}</p>
      {r.tracking && <div className="space-y-1 text-sm text-muted">{trackingLines(r.tracking).map((line) => <p key={line}>{line}</p>)}</div>}
      {r.unscoredMedMarks && <p className="text-sm text-muted">{unscoredMedText(r.unscoredMedMarks)}</p>}

      {(r.meds || r.prn.length > 0 || r.deviations || r.labs.length > 0 || r.dietQuestions.length > 0) && (
        <section aria-label={L.main} className="space-y-2 rounded-2xl border border-accent/40 bg-surface p-3">
          <h2 className="font-semibold">{L.main}</h2>
          {r.prn.map((x) => ( /* D118 */
            <p key={x.title}>{t.prn.report(x.title, x.total, x.days)}{x.over.length > 0 && <span className="block text-sm text-warn">{t.prn.over(prnLimitText(x.limit!), x.over.map((d) => d.slice(8, 10) + '.' + d.slice(5, 7)).join(', '))}</span>}
              {x.unmatched > 0 && <span className="block text-sm text-muted">{t.prn.reportUnmatched(x.unmatched)}</span>}</p>
          ))}
          {r.meds && <p>{L.meds(r.meds.taken, r.meds.due)}
            {r.meds.list.length > 1 ? <span className="mt-1 block space-y-0.5 text-sm text-muted">{r.meds.list.map((m) => <span key={m.title} className="block">{L.medLine(m)}</span>)}</span>
              : r.meds.missed.length > 0 && <span className="block text-sm text-muted">{r.meds.missed.map((m) => L.missed(m.title, m.count)).join(' · ')}</span>}</p>}
          {!!r.meds?.unmarked && <p className="text-sm text-muted">Без відмітки: {r.meds.unmarked} доз.</p>}
          {r.deviations && (r.deviations.meals ? (
            <p>{L.deviations(r.deviations.meals, r.deviations.of)}
              <span className="block text-sm text-muted">{r.deviations.by.map((b) => `${b.title} — ${b.count}`).join(' · ')}</span></p>
          ) : <p>{L.noDeviations(r.deviations.of)}</p>)}
          {r.labs.length > 0 && (
            <table className="w-full tabular text-sm">
              <caption className="mb-1 text-left font-medium">{L.labs}</caption>
              <tbody>{r.labs.map((l) => (
                <tr key={l.date + l.name} className="border-t border-line"><td className="py-1">{l.name}</td>
                  <td className="py-1 text-right">{num(l.value)} {l.unit}{l.target && <span className="block text-xs text-muted">{t.menu.target} {l.target}</span>}</td>
                  <td className="whitespace-nowrap py-1 pl-2 text-right text-muted">{format(parseISO(l.date), 'dd.MM')}</td></tr>
              ))}</tbody>
            </table>
          )}
          {r.medFood > 0 && <p className="text-sm">{t.medFood.report(r.medFood)}</p>}
          {r.dietQuestions.map((q) => <p key={q} className="text-sm text-warn">{q}</p>)}
          <p className="text-xs text-muted">{L.mainHint}</p>
        </section>
      )}

      {(!r.observed || r.checklistPct != null || r.observed.weight || r.observed.workout || r.observed.wellbeing) && (
        <dl className="grid grid-cols-2 gap-3 protocol-card rounded-2xl border border-line bg-surface p-3 tabular sm:grid-cols-4">
          {(!r.observed || r.checklistPct != null) && <Metric label={L.checklist} value={r.checklistPct != null ? `${r.checklistPct} %` : '—'} />}
          {r.observed?.weight !== false && <Metric label={L.weight} value={r.weightStart != null ? `${num(r.weightStart)} → ${num(r.weightNow!)} кг` : '—'} />}
          {r.observed?.workout !== false && <Metric label={L.workouts} value={String(r.workouts)} />}
          {r.observed?.wellbeing !== false && <Metric label={L.energy} value={r.avgEnergy != null ? `${num(r.avgEnergy)} ${L.of5}` : '—'} />}
        </dl>
      )}

      {(r.weightPace != null || r.habits.length > 0 || r.menu) && (
        <section className="protocol-card rounded-2xl border border-line bg-surface p-3">
          <h2 className="mb-2 font-semibold">{L.howPlan}</h2>
          {r.weightPace != null && (
            <p className={`mb-2 ${r.maxLossPerWeek != null && -r.weightPace > r.maxLossPerWeek ? 'font-semibold text-warn' : ''}`}>
              {L.pace(`${r.weightPace > 0 ? '+' : r.weightPace < 0 ? '−' : ''}${num(Math.abs(r.weightPace))}`)}
              {r.maxLossPerWeek != null && <span className="text-muted"> {L.paceLimit(num(r.maxLossPerWeek))}</span>}</p>
          )}
          {r.habits.length > 0 && (
            <table className="w-full tabular text-sm">
              <caption className="mb-1 text-left text-muted">{L.habitsCaption}</caption>
              <tbody>{r.habits.map((h) => (
                <tr key={h.key} className="border-t border-line"><td className="py-1">{habitLabel(h.key)}</td>
                  <td className="py-1 text-right">{L.ofDays(h.met, h.of)}</td></tr>
              ))}</tbody>
            </table>
          )}
          {r.menu && <p className="mt-2 text-sm">{L.menu(r.menu.done, r.menu.skipped, r.menu.open)}</p>}
        </section>
      )}

      <section className="protocol-card rounded-2xl border border-line bg-surface p-3">
        <h2 className="mb-2 font-semibold">{L.symptoms}</h2>
        {r.symptoms.length ? (
          <ul className="space-y-1">{r.symptoms.map((s) => (
            <li key={s.name} className="flex justify-between gap-2"><span>{s.name}</span><span className="tabular text-muted">{s.count} {s.count === 1 ? 'раз' : s.count < 5 ? 'рази' : 'разів'}</span></li>
          ))}</ul>
        ) : <p className="text-muted">{L.noSymptoms}</p>}
        {r.coincidences.length > 0 && (
          <div className="mt-3 border-t border-line pt-2">
            <h3 className="font-medium">{L.coincidences}</h3>
            <p className="mb-1 text-sm text-muted">{L.coincidencesHint}</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">{r.coincidences.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
      </section>

      <section className="protocol-card rounded-2xl border border-line bg-surface p-3">
        <h2 className="mb-2 font-semibold">{L.questions}</h2>
        <ol className="list-decimal space-y-1 pl-5">
          {questions.map((q, i) => (
            <li key={i}><span className="flex items-start justify-between gap-2"><span className="py-2">{q}</span>
              <button type="button" onClick={() => void saved(db.plan.update('main', { questions: questions.filter((_, j) => j !== i) }), t.toast.deleted(q), () => db.plan.update('main', { questions }))} aria-label={`${t.plan.delete}: ${q}`}
                className="flex min-h-tap min-w-tap items-center justify-center text-muted print:hidden"><Trash2 size={18} /></button></span></li>
          ))}
        </ol>
        <form className="mt-2 flex gap-2 print:hidden" onSubmit={(e) => { e.preventDefault(); const q = question.trim(); if (q) void setQuestions([...questions, q], t.toast.question); setQuestion(''); }}>
          <label className="flex-1"><span className="sr-only">{L.addQuestion}</span>
            <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={L.questionPh} className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
          <button type="submit" className="flex min-h-tap items-center gap-1 rounded-xl border border-accent px-3 text-accent"><Plus size={18} />{t.well.add}</button>
        </form>
      </section>

      <div className="flex flex-wrap gap-2 print:hidden">
        <button type="button" onClick={() => { void count('report'); window.print(); }} className="flex min-h-tap flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-medium text-surface"><Printer size={18} />{L.print}</button>
        <button type="button" onClick={() => void share()} className="flex min-h-tap flex-1 items-center justify-center gap-2 rounded-xl border border-accent px-4 font-medium text-accent"><Share2 size={18} />{shared || L.share}</button>
      </div>
      <div className="print:hidden">
        <button type="button" onClick={() => { void saved(db.plan.update('main', { lastVisit: today }), t.toast.visit); setRange({ to: today }); }}
          className="min-h-tap text-accent underline">{L.visited}</button>
        {plan.lastVisit && <p className="text-sm text-muted">{L.visitedNote(dmy(plan.lastVisit))}</p>}
      </div>
      <p className="text-sm text-muted">{t.plan.disclaimer}</p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-sm text-muted">{label}</dt><dd className="text-lg font-semibold">{value}</dd></div>;
}
