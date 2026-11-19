// D191: «Питання лікарю» — the open list (add, take away), after the visit «Спитав» and the answer in one line; the answers
// kept apart. `soon` (on «Сьогодні», 0–3 days before the visit) shows the list only, with a link to all of it.
import { X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../data/db';
import { todayISO } from '../domain/dates';
import { afterVisit, answer } from '../domain/doctorQuestions';
import type { Plan } from '../domain/types';
import { t } from '../i18n/uk';
import { saved } from './Toast';

const L = t.ask;
const dmy = (d: string) => d.split('-').reverse().join('.');

export function DoctorQuestions({ plan, soon }: { plan: Plan; soon?: number }) {
  const today = todayISO();
  const [text, setText] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const open = plan.questions ?? [];
  const done = plan.answered ?? [];
  const after = afterVisit(plan, today);
  const setQuestions = (questions: string[], say: string) => saved(db.plan.update('main', { questions }), say);
  if (soon !== undefined) {
    if (!open.length) return null;
    return (
      <section aria-label={L.title} className="protocol-card mb-3 space-y-2 p-3" data-testid="questions-soon">
        <p className="font-medium">{L.soon(soon)}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">{open.map((q) => <li key={q}>{q}</li>)}</ul>
        <Link to="/plan" className="inline-flex min-h-tap items-center text-sm text-accent underline">{L.open}</Link>
      </section>
    );
  }
  return (
    <section aria-label={L.title} className="protocol-card space-y-3 p-4" data-testid="doctor-questions">
      <h2 className="text-lg font-semibold">{L.title}</h2>
      {open.length ? <ul className="divide-y divide-line">
        {open.map((q) => (
          <li key={q} className="space-y-2 py-2">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 break-words">{q}</p>
              {after && asking !== q && <button type="button" onClick={() => { setAsking(q); setReply(''); }} className="min-h-tap rounded-full border-2 border-accent px-3 text-sm font-semibold text-accent">{L.asked}</button>}
              <button type="button" aria-label={L.remove(q)} onClick={() => void setQuestions(open.filter((x) => x !== q), t.toast.deleted(q))}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-muted"><X size={18} aria-hidden /></button>
            </div>
            {asking === q && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void saved(db.plan.update('main', answer(plan, q, reply, today)), t.toast.saved); setAsking(null); }}>
              <label className="min-w-0 flex-1"><span className="sr-only">{L.answer}</span>
                <input value={reply} onChange={(e) => setReply(e.target.value)} maxLength={200} placeholder={L.answer} className="min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
              <button type="submit" className="min-h-tap rounded-xl bg-accent px-3 font-semibold text-on-accent">{L.save}</button>
            </form>}
          </li>
        ))}
      </ul> : <p className="text-sm text-muted">{L.empty}</p>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const q = text.trim(); if (q && !open.includes(q)) void setQuestions([...open, q], t.toast.saved); setText(''); }}>
        <label className="min-w-0 flex-1"><span className="sr-only">{L.placeholder}</span>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={L.placeholder} className="min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
        <button type="submit" disabled={!text.trim()} className="min-h-tap rounded-xl border-2 border-accent px-3 font-semibold text-accent disabled:opacity-40">{L.add}</button>
      </form>
      {done.length > 0 && <div className="border-t border-line pt-2">
        <h3 className="mb-1 text-sm font-semibold">{L.answered}</h3>
        <ul className="space-y-1 text-sm">{[...done].reverse().map((x) => <li key={`${x.at}:${x.q}`}><span className="font-medium">{x.q}</span>{x.a ? ` — ${x.a}` : ''} <span className="text-muted">· {dmy(x.at)}</span></li>)}</ul>
      </div>}
    </section>
  );
}
