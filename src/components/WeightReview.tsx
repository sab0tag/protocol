import { useEffect, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { db } from '../data/db';
import { todayISO } from '../domain/dates';
import { validWeightDate, weightInputProblem, weightQuality } from '../domain/weightQuality';
import type { WeightLog } from '../domain/types';
import { t } from '../i18n/uk';
import { saved } from './Toast';
const L = t.weightQuality, P = t.progress;
const displayWeight = (value: number) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('uk-UA', { maximumFractionDigits: 1 }) : String(value);
const displayDate = (date: string) => validWeightDate(date) ? format(parseISO(date), 'd.MM.yyyy') : String(date);
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
export function WeightReview({ weights }: { weights: WeightLog[] }) {
  const [editing, setEditing] = useState<WeightLog>();
  const [date, setDate] = useState(todayISO());
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(30);
  const lock = useRef(false), input = useRef<HTMLInputElement>(null);
  const quality = weightQuality(weights);
  useEffect(() => { if (editing) { setDate(String(editing.date ?? '')); setValue(String(editing.kg)); setError(''); input.current?.focus(); } }, [editing]);
  const save = async () => {
    if (lock.current) return;
    const n = Number(value.trim().replace(',', '.'));
    const problem = weightInputProblem(date, n);
    if (problem) { setError(L.reasons[problem]); return; }
    const amount = Math.round(n * 10) / 10;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await saved(db.transaction('rw', db.weights, async () => {
        const previous = await db.weights.get(editing?.date ?? date);
        if (editing && date !== editing.date && await db.weights.get(date)) { setError(L.dateBusy); throw new Error('weight_changed'); }
        // Check edits against the displayed row, so another tab cannot be silently overwritten.
        if (editing && JSON.stringify(previous) !== JSON.stringify(editing)) { setError(L.changed); throw new Error('weight_changed'); }
        const row: WeightLog = { date, kg: amount,
          ...(previous ? { corrections: [...(Array.isArray(previous.corrections) ? previous.corrections : []), { date: previous.date, kg: previous.kg, at: new Date().toISOString() }] } : {}) };
        if (previous?.reviewedKg === amount && previous.date === date) { row.reviewedKg = amount; row.reviewedAt = previous.reviewedAt; }
        if (editing && editing.date !== date) await db.weights.delete(editing.date);
        await db.weights.put(row); return { previous, row };
      }), t.toast.weight(amount.toLocaleString('uk-UA')));
      if (result) { setEditing(undefined); setValue(''); }
    } finally { lock.current = false; setBusy(false); }
  };
  const confirm = async (row: WeightLog) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await saved(db.transaction('rw', db.weights, async () => {
      const current = await db.weights.get(row.date);
      if (!current || JSON.stringify(current) !== JSON.stringify(row)) throw new Error('weight_changed');
      await db.weights.put({ ...current, reviewedKg: current.kg, reviewedAt: new Date().toISOString() }); return true;
    }), L.reviewed); } finally { lock.current = false; setBusy(false); }
  };
  return <div className="mt-4 space-y-3 border-t border-line pt-4">
    {weights.length > 0 && <details open={quality.pending.length > 0} id="weight-history">{/* D149: no empty history to open */}
      <summary className="min-h-tap cursor-pointer py-2 font-medium">{L.history}</summary>
      <ul className="divide-y divide-line">{[...weights].reverse().slice(0, limit).map(row => {
        const problem = quality.pending.find(p => p.record === row)?.reason;
        return <li key={row.date} className="space-y-2 py-3">
          <div className="flex items-center gap-2"><span className="min-w-0 flex-1 break-words tabular">{displayDate(row.date)} · {displayWeight(row.kg)} {P.kg}</span>
            <button type="button" className="flex min-h-tap min-w-tap items-center justify-center text-accent" disabled={busy} aria-label={`${L.edit}: ${row.date}`} onClick={() => setEditing(row)}><Pencil size={18} aria-hidden /></button>
            <button type="button" className="flex min-h-tap min-w-tap items-center justify-center text-muted" disabled={busy} aria-label={`${L.remove}: ${row.date}`} onClick={() => void saved(db.transaction('rw', db.weights, async () => {
              if (JSON.stringify(await db.weights.get(row.date)) !== JSON.stringify(row)) throw new Error('weight_changed');
              await db.weights.delete(row.date); return true;
            }), t.toast.deleted(P.weight), () => db.transaction('rw', db.weights, async () => {
              if (await db.weights.get(row.date)) throw new Error('weight_changed');
              await db.weights.put(row);
            }))}><Trash2 size={18} aria-hidden /></button>
          </div>
          {problem && <p className="text-sm text-warn">{L.reasons[problem]}</p>}
          {problem === 'jump' && <button type="button" disabled={busy} className="protocol-action-secondary" onClick={() => void confirm(row)}>{L.confirm}: {displayWeight(row.kg)} {P.kg}</button>}
          {Array.isArray(row.corrections) && row.corrections.length > 0 && <details className="text-xs text-muted"><summary className="min-h-tap cursor-pointer py-2">{L.correction}</summary><ul>{row.corrections.map((c, i) => <li key={i}>{String(c.date)} · {String(c.kg)} {P.kg} · {String(c.at)}</li>)}</ul></details>}
        </li>;
      })}</ul>
      {weights.length > limit && <button type="button" className="min-h-tap text-accent underline" onClick={() => setLimit(limit + 30)}>{L.more}</button>}
    </details>}
    <form aria-label={editing ? L.edit : P.addWeight} className="grid grid-cols-1 items-end gap-3 min-[380px]:grid-cols-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label className="block min-w-0"><span className="text-sm text-muted">{P.date}</span><input required type="date" value={date} max={todayISO()} onChange={e => setDate(e.target.value)} className={field} /></label>
      <label className="block min-w-0"><span className="text-sm text-muted">{P.weight}, {P.kg}</span><input ref={input} required inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} className={field} /></label>
      <button type="submit" disabled={busy} className="protocol-action min-[380px]:col-span-2 sm:col-span-1" aria-label={editing ? L.save : P.addWeight}>{editing ? L.save : <Plus size={18} aria-hidden />}</button>
      {error && <p role="alert" className="text-sm text-warn min-[380px]:col-span-2 sm:col-span-3">{error}</p>}
      {editing && <button type="button" className="min-h-tap text-accent underline" onClick={() => { setEditing(undefined); setValue(''); setError(''); }}>{L.cancel}</button>}
    </form>
  </div>;
}
