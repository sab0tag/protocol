// D68: «Фото бланка» — Claude copies the values off a lab results form; the person checks each number against the paper,
// fixes what is wrong, ticks what to keep, and only then they go to «Аналізи». The form's reference range is shown
// beside the value, never taken for the doctor's target (the target stays as it was for that test).
import { useLiveQuery } from 'dexie-react-hooks';
import { FileScan } from 'lucide-react';
import { useRef, useState } from 'react';
import { db } from '../data/db';
import { todayISO } from '../domain/dates';
import type { LabRow } from '../domain/progress';
import type { LabResult } from '../domain/types';
import { t } from '../i18n/uk';
import { ApiError, labs as readLabs } from '../sync/api';
import { currentKeys } from '../sync/runner';
import { shrink } from '../sync/shrink';
import { saved } from './Toast';

const L = t.labsScan;
const field = 'block min-h-tap w-full rounded-xl border border-line bg-bg px-2';
interface Row { on: boolean; name: string; value: string; unit: string; reference: string | null }

export function LabsScan({ known }: { known: LabRow[] }) {
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'none' | 'consent' | 'busy' | 'form'>('none');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');

  const pick = () => {
    setError('');
    if (!meta || !currentKeys()) { setError(L.needsSync); return; }
    if (!meta.labsConsent) { setState('consent'); return; }
    input.current?.click();
  };
  const read = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    const keys = currentKeys();
    if (!file || !keys) return;
    setState('busy');
    try {
      const r = await readLabs(keys, await shrink(file, 2000, 0.85), known.map((k) => k.name)); // small print — more detail
      if (!r.readable || !r.items.length) { setError(r.note ?? L.unreadable); setState('none'); return; }
      setRows(r.items.map((x) => ({ on: true, name: x.name, value: String(x.value).replace('.', ','), unit: x.unit, reference: x.reference })));
      setDate(r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : todayISO()); setNote(r.note ?? ''); setState('form');
    } catch (e) {
      const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
      setError((t.meal.photoErrors as Record<string, string>)[code] ?? t.meal.photoErrors.other); setState('none');
    }
  };
  const chosen = rows.filter((r) => r.on && r.name.trim() && !Number.isNaN(Number(r.value.replace(',', '.'))) && r.value.trim());
  const save = async () => {
    const out: LabResult[] = chosen.map((r) => {
      const target = known.find((k) => k.name === r.name.trim())?.target;
      return { date, name: r.name.trim(), value: Number(r.value.replace(',', '.')), unit: r.unit.trim(), ...(target ? { target } : {}) };
    });
    await saved(db.labs.bulkPut(out), L.saved(out.length), () => db.labs.bulkDelete(out.map((x) => [x.date, x.name] as [string, string])));
    setState('none'); setRows([]);
  };
  const set = (i: number, patch: Partial<Row>) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="mb-3">
      {state !== 'form' && (
        <button type="button" onClick={pick} disabled={state === 'busy'} className="flex min-h-tap items-center gap-2 text-accent underline disabled:opacity-40">
          <FileScan size={18} aria-hidden />{state === 'busy' ? L.busy : L.button}</button>
      )}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void read(e.target.files?.[0])} />
      {state === 'consent' && (
        <div className="mt-2 space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
          <p>{L.consent}</p>
          <button type="button" onClick={async () => { await db.meta.update('sync', { labsConsent: true }); setState('none'); input.current?.click(); }}
            className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.allow}</button>
        </div>
      )}
      {state === 'form' && (
        <section aria-label={L.check} className="mt-2 space-y-2 rounded-xl border border-accent/40 p-2">
          <p className="text-sm font-medium">{L.check}</p>
          {note && <p className="text-sm text-warn">{note}</p>}
          <label className="block w-44"><span className="text-sm text-muted">{L.date}</span>
            <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className={`mt-1 ${field}`} /></label>
          <ul className="divide-y divide-line">
            {rows.map((r, i) => (
              <li key={i} className="grid grid-cols-[auto_1fr_5rem_4.5rem] items-center gap-2 py-2">
                <input type="checkbox" checked={r.on} onChange={(e) => set(i, { on: e.target.checked })} aria-label={`${L.keep}: ${r.name}`} className="h-5 w-5 accent-[rgb(var(--accent))]" />
                <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={L.name} className={field} />
                <input inputMode="decimal" value={r.value} onChange={(e) => set(i, { value: e.target.value })} aria-label={`${L.value}: ${r.name}`} className={`${field} text-right tabular`} />
                <input value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} aria-label={`${L.unit}: ${r.name}`} className={field} />
                {r.reference && <span className="col-start-2 col-end-5 -mt-1 text-xs text-muted">{L.reference(r.reference)}</span>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!chosen.length} onClick={() => void save()}
              className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">{L.save(chosen.length)}</button>
            <button type="button" onClick={() => { setState('none'); setRows([]); }} className="min-h-tap rounded-xl border border-line px-3">{t.meal.cancel}</button>
          </div>
        </section>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-warn">{error}</p>}
    </div>
  );
}
