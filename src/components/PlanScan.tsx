// D80: «Фото висновку лікаря» — Claude copies the limits, medicines, targets and the next visit off the paper; the app
// checks each line, shows them all unticked, and only the lines the person ticks after comparing with the paper go into
// «План» (with «Скасувати»). Like the lab form (D68): the model reads, the person decides.
import { format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileScan } from 'lucide-react';
import { useRef, useState } from 'react';
import { db, type PlanRow } from '../data/db';
import { applyLines, draftLines, sourceOf, type DraftLine } from '../domain/conclusion';
import { newId } from '../domain/dates';
import { t } from '../i18n/uk';
import { ApiError, conclusion as readConclusion } from '../sync/api';
import { currentKeys } from '../sync/runner';
import { shrink } from '../sync/shrink';
import { NeedsSync } from './NeedsSync';
import { saved } from './Toast';

const L = t.conclusion;
const P = t.plan;
const GROUPS = ['prescription', 'constraint', 'target', 'checkup'] as const;

export function PlanScan({ plan, onDone }: { plan: PlanRow; onDone?: () => void }) {
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'none' | 'nosync' | 'consent' | 'busy' | 'form'>('none');
  const [error, setError] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');

  const pick = () => {
    setError('');
    if (!meta || !currentKeys()) { setState('nosync'); return; }
    if (!meta.conclusionConsent) { setState('consent'); return; }
    input.current?.click();
  };
  const read = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    const keys = currentKeys();
    if (!file || !keys) return;
    setState('busy');
    try {
      const r = await readConclusion(keys, await shrink(file, 2000, 0.85)); // small print — more detail
      if (!r.readable) { setError(r.note ?? L.unreadable); setState('none'); return; }
      const ls = draftLines(r, newId);
      if (!ls.length) { setError(r.note ?? L.nothing); setState('none'); return; }
      setLines(ls); setOn(new Set()); setSource(sourceOf(r)); setNote(r.note ?? ''); setState('form'); // nothing ticked for the person
    } catch (e) {
      const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
      setError((t.meal.photoErrors as Record<string, string>)[code] ?? t.meal.photoErrors.other); setState('none');
    }
  };
  const save = async () => {
    const picked = lines.filter((l) => on.has(l.key));
    const before = { constraints: plan.constraints, prescriptions: plan.prescriptions, targets: plan.targets, nextCheckup: plan.nextCheckup };
    await saved(db.plan.update('main', applyLines(plan, picked)), L.saved(picked.length), () => db.plan.update('main', before));
    setState('none'); setLines([]);
    onDone?.();
  };
  const toggle = (key: string) => setOn((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="space-y-2 rounded-2xl border border-line bg-surface p-3">
      {state !== 'form' && (
        <>
          <button type="button" onClick={pick} disabled={state === 'busy'} className="flex min-h-tap items-center gap-2 font-medium text-accent disabled:opacity-40">
            <FileScan size={20} aria-hidden />{state === 'busy' ? L.busy : L.button}</button>
          {state === 'none' && <p className="text-sm text-muted">{L.hint}</p>}
        </>
      )}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void read(e.target.files?.[0])} />
      {state === 'nosync' && <NeedsSync text={L.needsSync} />}
      {state === 'consent' && (
        <div className="space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
          <p>{L.consent}</p>
          <button type="button" onClick={async () => { await db.meta.update('sync', { conclusionConsent: true }); setState('none'); input.current?.click(); }}
            className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.allow}</button>
        </div>
      )}
      {state === 'form' && (
        <section aria-label={L.check} className="space-y-3">
          <p className="font-medium">{L.check}</p>
          <p className="text-sm text-muted">{L.from(source)}</p>
          {note && <p className="text-sm text-warn">{note}</p>}
          <button type="button" onClick={() => setOn(on.size === lines.length ? new Set() : new Set(lines.map((l) => l.key)))}
            className="min-h-tap text-sm text-accent underline">{on.size === lines.length ? L.none : L.all}</button>
          {GROUPS.map((g) => {
            const ls = lines.filter((l) => l.kind === g);
            if (!ls.length) return null;
            return (
              <div key={g}>
                <h3 className="text-sm font-semibold text-muted">{L.groups[g]}</h3>
                <ul className="divide-y divide-line">
                  {ls.map((l) => (
                    <li key={l.key}>
                      <label className="flex min-h-tap items-start gap-3 py-2">
                        <input type="checkbox" checked={on.has(l.key)} onChange={() => toggle(l.key)} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--accent))]" />
                        <LineText line={l} plan={plan} />
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!on.size} onClick={() => void save()}
              className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">{L.save(on.size)}</button>
            <button type="button" onClick={() => { setState('none'); setLines([]); }} className="min-h-tap rounded-xl border border-line px-3">{t.meal.cancel}</button>
          </div>
        </section>
      )}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
    </div>
  );
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function LineText({ line: l, plan }: { line: DraftLine; plan: PlanRow }) {
  const updates = <span className="text-xs text-muted"> · {L.updates}</span>;
  if (l.kind === 'constraint') {
    const c = l.constraint;
    const exists = plan.constraints.some((x) => (c.tag === 'custom' || c.tag === 'allergy' ? same(x.title, c.title) : x.tag === c.tag));
    return <span><span className="font-medium">{c.title}</span>{exists && updates}
      {c.reason && <span className="block text-sm text-muted">{c.reason}</span>}</span>;
  }
  if (l.kind === 'prescription') {
    const p = l.prescription;
    const exists = plan.prescriptions.some((x) => same(x.title, p.title));
    const when = p.kind === 'test' ? '' : [p.schedule?.times.length ? p.schedule.times.join(', ') : L.noTime,
      p.schedule?.withFood === true ? L.withFood : p.schedule?.withFood === false ? L.empty : ''].filter(Boolean).join(' · ');
    return <span><span className="font-medium">{p.title}</span>{p.dose && ` · ${p.dose}`}{exists && updates}
      <span className="block text-sm text-muted">{[P.kinds[p.kind], l.frequency, when].filter(Boolean).join(' · ')}</span></span>;
  }
  if (l.kind === 'target') {
    const label = l.key === 'carbsG' ? P.target.carbsMax : P.target[l.key as keyof typeof P.target];
    const value = typeof l.value === 'object' ? String(l.value.max ?? '') : String(l.value).replace('.', ',');
    return <span>{label}: <span className="font-medium">{value}</span></span>;
  }
  return <span><span className="font-medium">{format(parseISO(l.date), 'd MMMM yyyy', { locale: uk })}</span>
    {l.tests.length > 0 && <span className="block text-sm text-muted">{l.tests.join(', ')}</span>}</span>;
}
