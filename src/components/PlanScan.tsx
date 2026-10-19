// D80, D101: «Фото висновку лікаря» — up to 4 pages; Claude copies the limits, the diet, medicines, targets and the next
// visit off the paper, each line with where it was read and how sure. The app checks every line and shows it with the
// piece of paper it came from and ✓ / ? / ✗; nothing is ticked for the person, medicines are ticked one by one (there is
// no «all» for them), and a medicine without its dose or time cannot be ticked (D100). Only the ticked lines go into
// «План» (with «Скасувати»). Works without sync — through this device's token (the first screen needs no account).
import { format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileScan } from 'lucide-react';
import { useRef, useState } from 'react';
import { db, inDemo, type PlanRow } from '../data/db';
import { useMedIndex } from '../data/medsIndex';
import { applyLines, draftLines, missing, sameConstraint, sourceOf, type DraftLine } from '../domain/conclusion';
import { newId, sinceNow } from '../domain/dates';
import { t } from '../i18n/uk';
import { ApiError, conclusion as readConclusion } from '../sync/api';
import { currentKeys } from '../sync/runner';
import { cut, shrink } from '../sync/shrink';
import { saved } from './Toast';

const L = t.conclusion;
const P = t.plan;
const GROUPS = ['meds', 'limits', 'targets', 'checks', 'unread'] as const;
const groupOf = (l: DraftLine): (typeof GROUPS)[number] => l.kind === 'unread' ? 'unread' : l.kind === 'constraint' ? 'limits' : l.kind === 'target' ? 'targets'
  : l.kind === 'checkup' || (l.kind === 'prescription' && l.prescription.kind === 'test') ? 'checks' : 'meds';
const isMed = (l: DraftLine) => groupOf(l) === 'meds';
const CONSENT = 'protocol.conclusionConsent';
const localConsent = () => { try { return localStorage.getItem(CONSENT) === '1'; } catch { return false; } };

export function PlanScan({ plan, onDone }: { plan: PlanRow; onDone?: () => void }) {
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'none' | 'demo' | 'consent' | 'busy' | 'form'>('none');
  const [error, setError] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [cuts, setCuts] = useState<Record<string, string>>({});
  const [on, setOn] = useState<Set<string>>(new Set());
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const index = useMedIndex(state === 'busy' || state === 'form');
  const indexRef = useRef(index);
  indexRef.current = index;

  const pick = () => {
    setError('');
    if (inDemo()) { setState('demo'); return; } // D98: nothing of the example goes to the server
    if (!meta?.conclusionConsent && !localConsent()) { setState('consent'); return; }
    input.current?.click();
  };
  const allow = async () => {
    try { localStorage.setItem(CONSENT, '1'); } catch { /* private mode — asked again next time */ }
    if (meta) await db.meta.update('sync', { conclusionConsent: true });
    setState('none'); input.current?.click();
  };
  const read = async (files: File[]) => {
    if (input.current) input.current.value = '';
    if (!files.length) return;
    if (files.length > 4) { setError(L.tooManyPages); return; }
    setState('busy');
    try {
      const pages = await Promise.all(files.map((f) => shrink(f, 2000, 0.85))); // small print — more detail
      const r = await readConclusion(currentKeys() ?? null, pages);
      if (!r.readable) { setError(r.note ?? L.unreadable); setState('none'); return; }
      const ls = draftLines(r, newId, { pages: pages.length, ...(indexRef.current ? { index: indexRef.current } : {}) });
      if (!ls.length) { setError(r.note ?? L.nothing); setState('none'); return; }
      setLines(ls); setOn(new Set()); setSource(sourceOf(r)); setNote(r.note ?? ''); setCuts({}); setState('form'); // nothing ticked for the person
      for (const l of ls) {
        if (l.from) void cut(pages[l.from.page - 1]!, l.from.box).then((u) => setCuts((c) => ({ ...c, [l.key]: u }))).catch(() => undefined);
      }
    } catch (e) {
      const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
      setError((t.meal.photoErrors as Record<string, string>)[code] ?? t.meal.photoErrors.other); setState('none');
    }
  };
  const save = async () => {
    const picked = lines.filter((l) => on.has(l.key));
    const before = { constraints: plan.constraints, prescriptions: plan.prescriptions, targets: plan.targets, nextCheckup: plan.nextCheckup };
    await saved(db.plan.update('main', applyLines(plan, picked, sinceNow())), L.saved(picked.length), () => db.plan.update('main', before));
    setState('none'); setLines([]); setCuts({});
    onDone?.();
  };
  const toggle = (key: string) => setOn((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  // «all» never covers medicines (each is confirmed by its own tap) nor a line marked «?» — that one is checked by hand (D103)
  const bulk = lines.filter((l) => l.status === 'sure' && !isMed(l));
  const allOn = bulk.length > 0 && bulk.every((l) => on.has(l.key));

  return (
    <div className="space-y-2 rounded-2xl border border-line bg-surface p-3">
      {state !== 'form' && (
        <>
          <button type="button" onClick={pick} disabled={state === 'busy'} className="flex min-h-tap items-center gap-2 font-medium text-accent disabled:opacity-40">
            <FileScan size={20} aria-hidden />{state === 'busy' ? L.busy : L.button}</button>
          {state === 'none' && <p className="text-sm text-muted">{L.hint}</p>}
        </>
      )}
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void read([...(e.target.files ?? [])])} />
      {state === 'demo' && <p className="text-sm text-muted">{L.demo}</p>}
      {state === 'consent' && (
        <div className="space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
          <p>{L.consent}</p>
          <button type="button" onClick={() => void allow()} className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.allow}</button>
        </div>
      )}
      {state === 'form' && (
        <section aria-label={L.check} className="space-y-3">
          <p className="font-medium">{L.check}</p>
          <p className="text-sm text-muted">{L.from(source)}</p>
          {note && <p className="text-sm text-warn">{note}</p>}
          {bulk.length > 1 && (
            <button type="button" onClick={() => setOn((s) => { const n = new Set(s); for (const l of bulk) { if (allOn) n.delete(l.key); else n.add(l.key); } return n; })}
              className="min-h-tap text-sm text-accent underline">{allOn ? L.none : L.all}</button>
          )}
          {GROUPS.map((g) => {
            const ls = lines.filter((l) => groupOf(l) === g);
            if (!ls.length) return null;
            return (
              <div key={g}>
                <h3 className="text-sm font-semibold text-muted">{L.groups[g]}</h3>
                {g === 'meds' && <p className="text-xs text-muted">{L.medsOneByOne}</p>}
                <ul className="divide-y divide-line">
                  {ls.map((l) => {
                    const lack = missing(l);
                    const body = (
                      <span className="min-w-0 flex-1">
                        <LineText line={l} plan={plan} known={!!index} />
                        <Status line={l} />
                        {lack && <span className="block text-sm text-warn">{lack === 'dose' ? L.needDose : L.needTime}</span>}
                        {cuts[l.key] && <img src={cuts[l.key]} alt={L.piece} className="mt-1 max-h-24 max-w-full rounded border border-line" />}
                      </span>
                    );
                    return (
                      <li key={l.key}>
                        {l.kind === 'unread' ? <div className="py-2">{body}</div> : (
                          <label className="flex min-h-tap items-start gap-3 py-2">
                            <input type="checkbox" checked={on.has(l.key)} disabled={!!lack} onChange={() => toggle(l.key)} aria-label={nameOf(l)}
                              className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--accent))] disabled:opacity-40" />
                            {body}
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!on.size} onClick={() => void save()}
              className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">{L.save(on.size)}</button>
            <button type="button" onClick={() => { setState('none'); setLines([]); setCuts({}); }} className="min-h-tap rounded-xl border border-line px-3">{t.meal.cancel}</button>
          </div>
        </section>
      )}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
    </div>
  );
}

/** The checkbox's own name — a screen reader said only «checkbox» (D103). */
function nameOf(l: DraftLine): string {
  if (l.kind === 'prescription') return [l.prescription.title, l.prescription.dose].filter(Boolean).join(' ');
  if (l.kind === 'constraint') return l.constraint.title;
  if (l.kind === 'target') return l.target === 'carbsG' ? P.target.carbsMax : P.target[l.target as keyof typeof P.target];
  if (l.kind === 'checkup') return [L.groups.checks, day(l.date), l.title].filter(Boolean).join(', ');
  return l.text;
}

function Status({ line: l }: { line: DraftLine }) {
  const cls = l.status === 'sure' ? 'text-accent' : 'text-warn';
  return <span className={`block text-xs ${cls}`}>{L.status[l.status]}</span>;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const day = (d: string) => format(parseISO(d), 'd MMMM yyyy', { locale: uk });

function LineText({ line: l, plan, known }: { line: DraftLine; plan: PlanRow; known: boolean }) {
  const updates = <span className="text-xs text-muted"> · {L.updates}</span>;
  if (l.kind === 'unread') return <span><span className="font-medium">«{l.text}»</span><span className="block text-sm text-muted">{L.unreadHint}</span></span>;
  if (l.kind === 'constraint') {
    const c = l.constraint;
    const exists = plan.constraints.some((x) => sameConstraint(x, c));
    return <span><span className="font-medium">{c.title}</span>{exists && updates}
      {c.reason && <span className="block text-sm text-muted">{c.tag === 'diet' ? L.dietSaid(c.reason) : c.reason}</span>}</span>;
  }
  if (l.kind === 'prescription') {
    const p = l.prescription;
    const exists = plan.prescriptions.some((x) => same(x.title, p.title));
    const drug = p.kind === 'medication' || p.kind === 'supplement';
    const when = !drug ? '' : [p.asNeeded ? L.asNeeded : p.schedule?.times.length ? p.schedule.times.join(', ') + (l.suggested ? ` (${L.suggested})` : '') : '',
      p.schedule?.withFood === true ? L.withFood : p.schedule?.withFood === false ? L.empty : '',
      p.until ? L.until(format(parseISO(p.until), 'd.MM')) : ''].filter(Boolean).join(' · ');
    return <span><span className="font-medium">{p.title}</span>{p.dose && ` · ${p.dose}`}{exists && updates}
      <span className="block text-sm text-muted">{[P.kinds[p.kind], drug && known && !p.med ? L.notRegistered : '', l.frequency, when].filter(Boolean).join(' · ')}</span></span>;
  }
  if (l.kind === 'target') {
    const label = l.target === 'carbsG' ? P.target.carbsMax : P.target[l.target as keyof typeof P.target];
    const value = typeof l.value === 'object' ? String(l.value.max ?? '') : String(l.value).replace('.', ',');
    return <span>{label}: <span className="font-medium">{value}</span></span>;
  }
  return <span><span className="font-medium">{day(l.date)}</span>
    {l.title && <span className="block text-sm text-muted">{l.title}</span>}</span>;
}
