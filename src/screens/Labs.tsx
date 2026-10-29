import { LabsScan } from '../components/LabsScan';
import { ExampleNotice } from '../components/ExampleNotice';
import { Loading } from '../components/Recovery';
import { toast } from '../components/Toast';
import { useLabs, usePlan } from '../data/queries';
import { db } from '../data/db';
import { writeLab } from '../data/labs';
import { labDraft, labNumber, validateLab, type LabDraft, type LabField } from '../domain/labs';
import type { LabResult } from '../domain/types';
import { labRows } from '../domain/progress';
import { todayISO } from '../domain/dates';
import { t } from '../i18n/uk';
import { format, parseISO } from 'date-fns';
import { Pencil, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const L = t.progress;
const field = 'mt-1 block min-h-tap w-full min-w-0 rounded-xl border border-line bg-bg px-3';
const dm = (date: string) => format(parseISO(date), 'dd.MM');
const blank = (): LabDraft => ({ date: todayISO(), name: '', value: '', unit: '', target: '', reference: '' });
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${labNumber(Math.abs(n))}`;

export function Labs() {
  const labs = useLabs();
  const plan = usePlan();
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [original, setOriginal] = useState<LabResult>();
  const [lab, setLab] = useState<LabDraft>(blank);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null), add = useRef<HTMLButtonElement>(null), opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open) {
      (form.current?.elements.namedItem('name') as HTMLInputElement | null)?.focus({ preventScroll: true });
      form.current?.scrollIntoView({ block: 'nearest' });
    } else if (opener.current) {
      (opener.current.isConnected ? opener.current : add.current)?.focus();
    }
  }, [open]);
  if (!labs) return <Loading />;
  const rows = labRows(labs);
  const validation = validateLab(lab, todayISO());
  const errors: Partial<Record<LabField, true>> = submitted && !validation.ok ? validation.errors : {};
  const start = (button: HTMLButtonElement, result?: LabResult) => {
    opener.current = button; setOriginal(result); setLab(result ? labDraft(result) : blank());
    setSubmitted(false); setMessage(''); setOpen(true);
  };
  const save = async () => {
    if (busy) return;
    setSubmitted(true); setMessage('');
    if (!validation.ok) {
      const key = (['name', 'value', 'date'] as LabField[]).find(key => validation.errors[key]);
      (form.current?.elements.namedItem(key!) as HTMLInputElement | null)?.focus();
      return;
    }
    setBusy(true);
    try {
      const result = await writeLab(db, validation.result, original);
      if (result !== 'saved') { setMessage(result === 'exists' ? L.labExists : L.labChanged); return; }
      // The old history button will disappear when the live query delivers the moved record.
      if (original && (original.date !== validation.result.date || original.name !== validation.result.name)) opener.current = add.current;
      const next = { ...original, ...validation.result };
      if (!validation.result.target) delete next.target;
      if (!validation.result.reference) delete next.reference;
      toast(t.toast.lab(validation.result.name), original ? { undo: async () => {
        try {
          const result = await writeLab(db, original, next);
          if (result !== 'saved') toast(result === 'exists' ? L.labExists : L.labChanged, { tone: 'warn' });
        } catch { toast(t.toast.failed, { tone: 'warn' }); }
      } } : {});
      setOpen(false);
    } catch { setMessage(t.toast.failed); }
    finally { setBusy(false); }
  };
  const invalid = (key: LabField) => ({ 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? `lab-${key}-error` : undefined });
  const error = (key: LabField) => errors[key] && <p id={`lab-${key}-error`} className="mt-1 text-sm text-warn">{L.labErrors[key]}</p>;

  return (
    <section className="space-y-4 pt-4">
      <Link to="/progress" className="inline-flex min-h-tap items-center text-sm text-muted">{t.progress.title}</Link>
      <header className="protocol-scene-header flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{L.labs}</h1>
        <button ref={add} type="button" disabled={open} onClick={e => start(e.currentTarget)} aria-expanded={open} aria-controls="lab-editor"
          className="flex min-h-tap items-center gap-1 rounded-xl border border-white/30 bg-black/20 px-3 text-white disabled:opacity-60"><Plus size={18} aria-hidden />{L.addLab}</button>
      </header>
      <ExampleNotice plan={plan} />
      <LabsScan known={rows} />
      {open && (
        <form ref={form} id="lab-editor" aria-label={original ? L.editLab : L.addLab} noValidate
          className="protocol-card space-y-3 rounded-2xl border border-line bg-surface p-3" onSubmit={e => { e.preventDefault(); void save(); }}>
          <h2 className="font-semibold">{original ? L.editLab : L.addLab}</h2>
          {original && <p className="text-sm text-muted">{L.labEditHint}</p>}
          <fieldset disabled={busy} className="grid min-w-0 grid-cols-2 gap-3">
          <label className="col-span-2 block min-w-0"><span className="text-sm text-muted">{L.labName}</span>
            <input name="name" aria-label={L.labName} required value={lab.name} onChange={(e) => setLab({ ...lab, name: e.target.value })} list="lab-names" className={field} {...invalid('name')} />{error('name')}</label>
          <datalist id="lab-names">{rows.map((row) => <option key={row.name} value={row.name} />)}</datalist>
          <label className="block min-w-0"><span className="text-sm text-muted">{L.value}</span>
            <input name="value" aria-label={L.value} required inputMode="decimal" value={lab.value} onChange={(e) => setLab({ ...lab, value: e.target.value })} className={field} {...invalid('value')} />{error('value')}</label>
          <label className="block min-w-0"><span className="text-sm text-muted">{L.unit}</span>
            <input value={lab.unit} onChange={(e) => setLab({ ...lab, unit: e.target.value })} className={field} /></label>
          <label className="col-span-2 block min-w-0 sm:col-span-1"><span className="text-sm text-muted">{L.date}</span>
            <input name="date" aria-label={L.date} type="date" required max={todayISO()} value={lab.date} onChange={(e) => setLab({ ...lab, date: e.target.value })} className={field} {...invalid('date')} />{error('date')}</label>
          <label className="col-span-2 block min-w-0 sm:col-span-1"><span className="text-sm text-muted">{L.reference}</span>
            <input value={lab.reference} onChange={(e) => setLab({ ...lab, reference: e.target.value })} placeholder="3,9–5,6" className={field} /></label>
          <label className="col-span-2 block min-w-0 sm:col-span-1"><span className="text-sm text-muted">{L.target}</span>
            <input value={lab.target} onChange={(e) => setLab({ ...lab, target: e.target.value })} placeholder="< 5,6" className={field} /></label>
          <p className="col-span-2 text-xs text-muted">{L.referenceHint}</p>
          {message && <p role="alert" className="col-span-2 text-sm text-warn">{message}</p>}
          <button type="submit" className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{t.plan.save}</button>
          <button type="button" onClick={() => setOpen(false)} className="min-h-tap rounded-xl border border-line px-3">{t.plan.cancel}</button>
          </fieldset>
        </form>
      )}
      {rows.length ? (
        <>
        <ul aria-label={L.labs} className="space-y-3">{rows.map((row) => ( // D144: one card per test — no table to scroll at 320 px
          <li key={row.name} className="protocol-card rounded-2xl border border-line bg-surface p-3">
            <div className="flex items-start justify-between gap-3">
              <h3 className="min-w-0 break-words font-semibold">{row.name}</h3>
              <p className="shrink-0 text-right tabular"><span className="text-xl font-semibold">{labNumber(row.now.value)}</span> <span className="text-sm text-muted">{row.now.unit}</span>
                <span className="block text-xs text-muted">{dm(row.now.date)}</span></p>
            </div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">{L.previous}</dt>
              <dd className="tabular">{row.previous ? <>{labNumber(row.previous.value)} {row.previous.unit} · {dm(row.previous.date)}
                <span className="block text-xs text-muted">{row.change !== undefined ? L.change(signed(row.change), row.now.unit) : L.unitsOther}</span></> : L.noPrevious}</dd>
              <dt className="text-muted">{L.reference}</dt><dd>{row.reference ?? L.notStated}</dd>
              <dt className="text-muted">{L.target}</dt><dd>{row.target ?? L.notStated}</dd>
            </dl>
          </li>
        ))}</ul>
        <details onToggle={e => setHistoryOpen(e.currentTarget.open)} className="protocol-card rounded-2xl border border-line bg-surface p-3">
          <summary className="min-h-tap cursor-pointer py-2 font-medium">{L.labHistory} · {labs.length}</summary>
          {historyOpen && <ul className="divide-y divide-line">{[...labs].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)).map(result => (
            <li key={JSON.stringify([result.date, result.name])} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1 break-words"><p className="font-medium">{result.name}</p>
                <p className="text-sm">{labNumber(result.value)} {result.unit}<span className="ml-2 text-muted">{format(parseISO(result.date), 'dd.MM.yyyy')}</span></p></div>
              <button type="button" disabled={open} onClick={e => start(e.currentTarget, result)} aria-label={`${L.editLab}: ${result.name}, ${result.date}`}
                className="flex min-h-tap shrink-0 items-center gap-1 rounded-xl px-2 text-sm text-accent disabled:opacity-40"><Pencil size={16} aria-hidden />{t.plan.edit}</button>
            </li>
          ))}</ul>}
        </details>
        </>
      ) : <p className="protocol-card rounded-2xl border border-line bg-surface p-3 text-muted">{L.noLabs}</p>}
    </section>
  );
}
