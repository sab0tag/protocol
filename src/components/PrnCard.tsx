// D118: «за потреби» on «День» — each such medicine with today's count («сьогодні 2 з 4») and «Прийняв зараз». At the doctor's
// limit the next tap first shows the doctor's words — «Лікар указав: не більше 4 на добу» — and the record is made only
// on «Все одно записати»: what was taken is recorded, the app never says what to do.
import { useState } from 'react';
import { db } from '../data/db';
import { newId } from '../domain/dates';
import { prnLimit, prnMeds, prnTaken } from '../domain/prn';
import type { DayEntry, Plan, Prescription } from '../domain/types';
import { t } from '../i18n/uk';
import { saved } from './Toast';

const L = t.prn;

export function PrnCard({ plan, date, entries }: { plan: Plan; date: string; entries: DayEntry[] }) {
  const [asking, setAsking] = useState<string | null>(null);
  const meds = prnMeds(plan, date);
  if (!meds.length) return null;
  const take = async (p: Prescription) => {
    setAsking(null);
    const e: DayEntry = { id: newId(), at: new Date().toISOString(), kind: 'med', status: 'done', title: p.title, prescriptionId: p.id };
    await saved(db.entries.add(e), L.taken(p.title), () => db.entries.delete(e.id));
  };
  return (
    <section aria-label={L.title} className="mb-4 space-y-2 rounded-2xl border border-line bg-surface p-3">
      <p className="text-sm font-semibold text-muted">{L.title}</p>
      {meds.map((p) => {
        const n = prnTaken(p, entries, date), max = prnLimit(p), full = max !== undefined && n >= max;
        return (
          <div key={p.id} data-prn={p.title}>
            <div className="flex items-center gap-2">
              <p className="flex-1"><span className="font-medium">{p.title}</span>{p.dose && <span className="text-muted"> · {p.dose}</span>}
                <span className={`block text-sm ${full ? 'text-warn' : 'text-muted'}`}>{max ? L.countOf(n, max) : L.count(n)}</span></p>
              <button type="button" onClick={() => (full ? setAsking(p.id) : void take(p))}
                className="min-h-tap shrink-0 rounded-xl border border-accent px-3 text-sm font-medium text-accent">{L.takeNow}</button>
            </div>
            {asking === p.id && max !== undefined && (
              <div role="alert" className="mt-2 space-y-2 rounded-xl border border-warn/40 bg-warn-bg p-2 text-sm text-warn">
                <p>{L.limit(max, n)}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void take(p)} className="min-h-tap rounded-xl border border-warn px-3">{L.recordAnyway}</button>
                  <button type="button" onClick={() => setAsking(null)} className="min-h-tap rounded-xl border border-line px-3 text-ink">{L.dontRecord}</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
