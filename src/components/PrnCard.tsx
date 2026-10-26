// D118, R01: «за потреби» on «День» — each such medicine with today's use in the doctor's own unit («сьогодні 3 з 4 табл.») and
// «Прийняв зараз» with how much was taken. A record that would take the day over the limit first shows the doctor's words —
// «Лікар указав: не більше 4 табл. на добу» — and is made only on «Все одно записати»: what was taken is recorded, the app never
// says what to do. A limit that cannot be matched to the records says so instead of a remainder. Today's records can be
// corrected (the amount) or taken out; a double tap makes one record (its id is made when the form opens).
import { X } from 'lucide-react';
import { useState } from 'react';
import { db } from '../data/db';
import { newId, timeOf } from '../domain/dates';
import { prnLimit, prnMeds, prnRecords, prnUsed, proposedAmount } from '../domain/prn';
import { prnAmountText, prnLimitText } from '../domain/report';
import { LIMIT_UNITS, type AmountUnit, type DayEntry, type Plan, type Prescription } from '../domain/types';
import { t } from '../i18n/uk';
import { saved } from './Toast';

const L = t.prn;
const AMOUNT_UNITS = LIMIT_UNITS.filter((u): u is AmountUnit => u !== 'intake');
const dec = (n: number) => String(n).replace('.', ',');
const num = (s: string) => Number(s.replace(',', '.'));

interface Draft { id: string; pid: string; qty: string; unit: AmountUnit; asking?: boolean; busy?: boolean }

export function PrnCard({ plan, date, entries }: { plan: Plan; date: string; entries: DayEntry[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fixing, setFixing] = useState<{ id: string; qty: string } | null>(null);
  const meds = prnMeds(plan, date);
  if (!meds.length) return null;

  const open = (p: Prescription) => { const a = proposedAmount(p); setDraft({ id: newId(), pid: p.id, qty: a.qty !== undefined ? dec(a.qty) : '', unit: a.unit }); };
  const record = async (p: Prescription, d: Draft) => {
    setDraft({ ...d, busy: true });
    const e: DayEntry = { id: d.id, at: new Date().toISOString(), kind: 'med', status: 'done', title: p.title, prescriptionId: p.id, amount: { qty: num(d.qty), unit: d.unit } };
    await saved(db.entries.put(e), L.taken(p.title), () => db.entries.delete(e.id)); // put — a second tap writes the same record again
    setDraft(null);
  };
  const submit = (p: Prescription, d: Draft) => {
    if (d.busy || !(num(d.qty) > 0)) return;
    const limit = prnLimit(p);
    const after = limit ? prnUsed(limit, [...prnRecords(p, entries, date), { id: d.id, at: '', kind: 'med', status: 'done', title: p.title, amount: { qty: num(d.qty), unit: d.unit } }]) : null;
    if (!d.asking && after?.matched && after.used > after.limit.value) { setDraft({ ...d, asking: true }); return; } // the doctor's words first
    void record(p, d);
  };
  const fix = async (e: DayEntry, qty: number) => {
    setFixing(null);
    if (!(qty > 0) || !e.amount) return;
    await saved(db.entries.put({ ...e, amount: { ...e.amount, qty } }), t.toast.saved, () => db.entries.put(e));
  };

  return (
    <section aria-label={L.title} className="mb-4 space-y-2 protocol-card rounded-2xl border border-line bg-surface p-3">
      <p className="text-sm font-semibold text-muted">{L.title}</p>
      {meds.map((p) => {
        const records = prnRecords(p, entries, date), limit = prnLimit(p), used = limit ? prnUsed(limit, records) : null;
        const full = !!used?.matched && used.used >= used.limit.value;
        const d = draft?.pid === p.id ? draft : null;
        return (
          <div key={p.id} data-prn={p.title}>
            <div className="flex items-center gap-2">
              <p className="flex-1"><span className="font-medium">{p.title}</span>{p.dose && <span className="text-muted"> · {p.dose}</span>}
                <span className={`block text-sm ${full ? 'text-warn' : 'text-muted'}`}>{used?.matched
                  ? L.countOf(dec(used.used), prnAmountText(used.limit.value, used.limit.unit))
                  : L.count(records.length)}</span>
                {used && !used.matched && <span className="block text-xs text-warn">{L.unmatched}{limit?.source === 'legacy' ? ` · ${L.legacy}` : ''}</span>}</p>
              {!d && <button type="button" onClick={() => open(p)} className="min-h-tap shrink-0 rounded-xl border border-accent px-3 text-sm font-medium text-accent">{L.takeNow}</button>}
            </div>
            {d && (
              <form className="mt-2 space-y-2 rounded-xl border border-line p-2" aria-label={`${L.how}: ${p.title}`} onSubmit={(e) => { e.preventDefault(); submit(p, d); }}>
                <div className="flex items-end gap-2">
                  <label className="w-24"><span className="text-xs text-muted">{L.qty}</span>
                    <input inputMode="decimal" value={d.qty} onChange={(e) => setDraft({ ...d, qty: e.target.value, asking: false })} autoFocus
                      className="block min-h-tap w-full rounded-xl border border-line bg-bg px-2" /></label>
                  <label className="flex-1"><span className="text-xs text-muted">{L.unit}</span>
                    <select value={d.unit} onChange={(e) => setDraft({ ...d, unit: e.target.value as AmountUnit, asking: false })}
                      className="block min-h-tap w-full rounded-xl border border-line bg-bg px-2">
                      {AMOUNT_UNITS.map((u) => <option key={u} value={u}>{L.units[u]}</option>)}</select></label>
                </div>
                {d.asking && limit && used?.matched && (
                  <div role="alert" className="space-y-2 rounded-xl border border-warn/40 bg-warn-bg p-2 text-sm text-warn">
                    <p>{L.limit(prnLimitText(limit), prnAmountText(used.used, limit.unit))}</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={d.busy || !(num(d.qty) > 0)}
                    className={`min-h-tap rounded-xl px-3 font-medium disabled:opacity-40 ${d.asking ? 'border border-warn text-warn' : 'bg-accent text-surface'}`}>
                    {d.busy ? L.busy : d.asking ? L.recordAnyway : L.record}</button>
                  <button type="button" onClick={() => setDraft(null)} className="min-h-tap rounded-xl border border-line px-3">{d.asking ? L.dontRecord : L.cancel}</button>
                </div>
              </form>
            )}
            {records.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-sm text-muted">{records.map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <span className="tabular w-12">{timeOf(e.at)}</span>
                  {fixing?.id === e.id ? (
                    <form className="flex items-center gap-1" onSubmit={(ev) => { ev.preventDefault(); void fix(e, num(fixing.qty)); }}>
                      <input inputMode="decimal" value={fixing.qty} onChange={(ev) => setFixing({ id: e.id, qty: ev.target.value })} autoFocus aria-label={L.qty}
                        className="min-h-[2rem] w-16 rounded-lg border border-line bg-bg px-2" /><span>{L.units[e.amount!.unit]}</span>
                      <button type="submit" className="min-h-[2rem] rounded-lg border border-accent px-2 text-accent">{L.fixOk}</button>
                    </form>
                  ) : e.amount ? (
                    <button type="button" onClick={() => setFixing({ id: e.id, qty: dec(e.amount!.qty) })} aria-label={L.fix(prnAmountText(e.amount.qty, e.amount.unit))}
                      className="min-h-[2rem] underline decoration-dotted">{prnAmountText(e.amount.qty, e.amount.unit)}</button>
                  ) : <span>{L.noAmount}</span>}
                  <button type="button" onClick={() => void saved(db.entries.delete(e.id), t.toast.deleted(p.title), () => db.entries.put(e))}
                    aria-label={L.remove(timeOf(e.at))} className="ml-auto flex h-8 w-8 items-center justify-center"><X size={14} aria-hidden /></button>
                </li>))}</ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
