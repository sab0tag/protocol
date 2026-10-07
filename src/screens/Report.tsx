import { addDays, format, parseISO } from 'date-fns';
import { saved } from '../components/Toast';
import { uk } from 'date-fns/locale';
import { Plus, Printer, Share2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { db } from '../data/db';
import { useAllEntries, useAllWellbeing, useFoods, usePlan, useWeights, useWorkouts } from '../data/queries';
import { dateOf, todayISO } from '../domain/dates';
import { buildReport, reportText } from '../domain/report';
import { t } from '../i18n/uk';

const L = t.report;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const num = (n: number) => n.toLocaleString('uk-UA', { maximumFractionDigits: 1 });
const dmy = (d: string) => format(parseISO(d), 'd MMMM yyyy', { locale: uk });

/** «Звіт для лікаря» (SPEC.md §5.8): from the last visit to today by default; prints on one page. */
export function Report() {
  const plan = usePlan();
  const entries = useAllEntries();
  const wellbeing = useAllWellbeing();
  const workouts = useWorkouts();
  const weights = useWeights();
  const foods = useFoods();
  const today = todayISO();
  const [range, setRange] = useState<{ from?: string; to: string }>({ to: today });
  const [question, setQuestion] = useState('');
  const [shared, setShared] = useState('');
  if (!plan || !entries || !wellbeing || !workouts || !weights || !foods) return null;

  const first = [entries[0] && dateOf(entries[0].at), weights[0]?.date].filter(Boolean).sort()[0];
  const from = range.from ?? plan.lastVisit ?? first ?? format(addDays(new Date(), -13), 'yyyy-MM-dd');
  const r = buildReport({ from, to: range.to, plan, entries, workouts, wellbeing, weights, foods });
  const questions = plan.questions ?? [];
  const setQuestions = (q: string[], say: string = t.toast.saved) => saved(db.plan.update('main', { questions: q }), say);

  const share = async () => {
    const text = reportText(r, dmy);
    try {
      if (navigator.share) { await navigator.share({ title: L.title, text }); return; }
      await navigator.clipboard.writeText(text); setShared(L.copied);
    } catch { /* the user closed the share sheet */ }
  };

  return (
    <section className="space-y-4 pt-4 print:pt-0">
      <h1 className="text-2xl font-semibold">{L.title}</h1>
      <div className="grid grid-cols-2 gap-3 print:hidden">
        <label className="block"><span className="text-sm text-muted">{L.from}</span>
          <input type="date" value={from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} className={field} /></label>
        <label className="block"><span className="text-sm text-muted">{L.to}</span>
          <input type="date" value={range.to} max={today} onChange={(e) => setRange({ ...range, to: e.target.value })} className={field} /></label>
      </div>
      <p className="hidden print:block">{dmy(r.from)} — {dmy(r.to)} · {L.days(r.days)}</p>

      <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-surface p-3 tabular sm:grid-cols-4">
        <Metric label={L.checklist} value={r.checklistPct != null ? `${r.checklistPct} %` : '—'} />
        <Metric label={L.weight} value={r.weightStart != null ? `${num(r.weightStart)} → ${num(r.weightNow!)} кг` : '—'} />
        <Metric label={L.workouts} value={String(r.workouts)} />
        <Metric label={L.energy} value={r.avgEnergy != null ? `${num(r.avgEnergy)} ${L.of5}` : '—'} />
      </dl>

      <section className="rounded-2xl border border-line bg-surface p-3">
        <h2 className="mb-2 font-semibold">{L.symptoms}</h2>
        {r.symptoms.length ? (
          <ul className="space-y-1">{r.symptoms.map((s) => (
            <li key={s.name} className="flex justify-between gap-2"><span>{s.name}</span><span className="tabular text-muted">{s.count} {s.count === 1 ? 'раз' : s.count < 5 ? 'рази' : 'разів'}</span></li>
          ))}</ul>
        ) : <p className="text-muted">{L.noSymptoms}</p>}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-3">
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
        <button type="button" onClick={() => window.print()} className="flex min-h-tap flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-medium text-surface"><Printer size={18} />{L.print}</button>
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
