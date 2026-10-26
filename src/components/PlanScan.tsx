// D80, D101: «Фото висновку лікаря» — up to 4 pages; Claude copies the limits, the diet, medicines, targets and the next
// visit off the paper, each line with where it was read and how sure. The app checks every line and shows it with the
// piece of paper it came from and ✓ / ? / ✗; nothing is ticked for the person, medicines are ticked one by one (there is
// no «all» for them), and a medicine without its dose or time cannot be ticked (D100). Only the ticked lines go into
// «План» (with «Скасувати»). Works without sync — through this device's token (the first screen needs no account).
import { format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileScan, ShieldCheck } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { db, inDemo, type PlanRow } from '../data/db';
import { useMedIndex } from '../data/medsIndex';
import { applyLines, changes, closeFromToday, draftLines, missing, notOnPaper, sameConstraint, sourceOf, type Change, type DraftLine } from '../domain/conclusion';
import { newId, sinceNow, todayISO } from '../domain/dates';
import { t } from '../i18n/uk';
import { ApiError, conclusion as readConclusion } from '../sync/api';
import { currentKeys } from '../sync/runner';
import { cut, shrink } from '../sync/shrink';
import { PhotoPrep } from './PhotoPrep';
import { count } from '../data/tally';
import { saved } from './Toast';

const L = t.conclusion;
const P = t.plan;
const GROUPS = ['meds', 'limits', 'targets', 'checks', 'unread'] as const;
const groupOf = (l: DraftLine): (typeof GROUPS)[number] => l.kind === 'unread' ? 'unread' : l.kind === 'constraint' ? 'limits' : l.kind === 'target' ? 'targets'
  : l.kind === 'checkup' || (l.kind === 'prescription' && l.prescription.kind === 'test') ? 'checks' : 'meds';
const isMed = (l: DraftLine) => groupOf(l) === 'meds';
const CONSENT = 'protocol.conclusionConsent';
const localConsent = () => { try { return localStorage.getItem(CONSENT) === '1'; } catch { return false; } };

export function PlanScan({ plan, onDone, onboarding }: { plan: PlanRow; onDone?: () => void; onboarding?: boolean }) {
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'none' | 'demo' | 'consent' | 'prep' | 'busy' | 'form'>('none');
  const [raw, setRaw] = useState<string[]>([]); // D112: the pages as taken, before they are cut and painted over
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [cuts, setCuts] = useState<Record<string, string>>({});
  const [on, setOn] = useState<Set<string>>(new Set());
  const [skip, setSkip] = useState<Set<string>>(new Set()); // D113: a medicine decided against — not ticked on purpose
  const [close, setClose] = useState<Set<string>>(new Set()); // D115: medicines of the plan the new paper does not name, to close
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
    try { setRaw(await Promise.all(files.map((f) => shrink(f, 2000, 0.85)))); setState('prep'); } // small print — more detail
    catch { setError(t.meal.photoErrors.other); setState('none'); }
  };
  const send = async (pages: string[]) => { // D112: only what the person cut and painted over leaves the phone
    setRaw([]); setState('busy');
    try {
      const r = await readConclusion(currentKeys() ?? null, pages);
      if (!r.readable) { setError(r.note ?? L.unreadable); setState('none'); return; }
      const ls = draftLines(r, newId, { pages: pages.length, ...(indexRef.current ? { index: indexRef.current } : {}) });
      if (!ls.length) { setError(r.note ?? L.nothing); setState('none'); return; }
      setLines(ls); setOn(new Set()); setSkip(new Set()); setClose(new Set()); setSource(sourceOf(r)); setNote(r.note ?? ''); setCuts({}); setState('form'); // nothing ticked for the person
      for (const l of ls) {
        if (l.from) void cut(pages[l.from.page - 1]!, l.from.box).then((u) => setCuts((c) => ({ ...c, [l.key]: u }))).catch(() => undefined);
      }
    } catch (e) {
      const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
      setError((t.meal.photoErrors as Record<string, string>)[code] ?? t.meal.photoErrors.other); setState('none');
    }
  };
  const save = async () => {
    if (savingRef.current || (!on.size && !close.size) || undecided > 0) return;
    savingRef.current = true; setSaving(true);
    try {
      const picked = lines.filter((l) => on.has(l.key));
      const before = { constraints: plan.constraints, prescriptions: plan.prescriptions, targets: plan.targets, nextCheckup: plan.nextCheckup };
      // D114: the pieces of paper stay with the lines they came from — on this device only
      const placed = new Map<string, string>();
      const applied = applyLines(plan, picked, sinceNow(), placed);
      const next = { ...applied, prescriptions: closeFromToday(applied.prescriptions, close, todayISO()) }; // D115
      const pieces = picked.flatMap((l) => (cuts[l.key] && placed.get(l.key) ? [{ id: placed.get(l.key)!, url: cuts[l.key]!, at: new Date().toISOString(), source }] : []));
      const result = await saved(db.transaction('rw', db.plan, db.pieces, async () => { await db.plan.update('main', next); await db.pieces.bulkPut(pieces); return true; }), L.saved(picked.length + close.size),
        () => db.transaction('rw', db.plan, db.pieces, async () => { await db.plan.update('main', before); await db.pieces.bulkDelete(pieces.map((x) => x.id)); }));
      if (!result) return; // Keep the checked draft open so a failed write can be retried.
      // D120, D122: rows read off the paper and, of them, not put in (unticked, put aside, unreadable) — a bad reading must not look
      // good; a later visit's medicine «без змін» is already in the plan and counts in neither
      const read = lines.filter((l) => diff.get(l.key)?.kind !== 'same');
      if (read.length) { void count('photo_rows', read.length); void count('photo_unchecked', read.filter((l) => !on.has(l.key)).length); }
      setState('none'); setLines([]); setCuts({});
      onDone?.();
    } finally { savingRef.current = false; setSaving(false); }
  };
  const toggle = (key: string) => setOn((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  // «all» never covers medicines (each is confirmed by its own tap) nor a line marked «?» — that one is checked by hand (D103)
  const bulk = lines.filter((l) => l.status === 'sure' && !isMed(l));
  const allOn = bulk.length > 0 && bulk.every((l) => on.has(l.key));
  // D115: a later visit — each medicine against the plan, and the plan's medicines the paper does not name
  const diff = useMemo(() => changes(plan, lines), [plan, lines]);
  const gone = useMemo(() => (lines.length ? notOnPaper(plan, lines, todayISO()) : []), [plan, lines]);
  // D113: the plan does not start while a medicine read off the paper is neither confirmed nor put aside
  const undecided = onboarding ? lines.filter((l) => isMed(l) && !on.has(l.key) && !skip.has(l.key)).length : 0;
  const flip = (key: string) => setSkip((x) => { const n = new Set(x); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const step = state === 'form' ? 2 : state === 'prep' || state === 'busy' ? 1 : 0;
  const reviewCount = lines.filter((l) => l.status !== 'sure' || missing(l)).length;
  return (
    <div className="space-y-4">
      <ol aria-label={L.stepsLabel} className="grid grid-cols-3 gap-2 text-xs sm:text-sm">
        {L.steps.map((label, i) => (
          <li key={label} aria-current={step === i ? 'step' : undefined}
            className={`flex min-w-0 flex-col items-center gap-2 rounded-2xl border px-2 py-3 text-center sm:flex-row sm:px-3 sm:text-left ${step === i ? 'border-accent bg-accent/10 font-semibold' : 'border-line text-muted'}`}>
            <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs">{i + 1}</span>
            <span className="min-w-0">{label}</span>
          </li>
        ))}
      </ol>
      {state === 'prep' && <PhotoPrep pages={raw} onDone={(p) => void send(p)} onCancel={() => { setRaw([]); setState('none'); }} />}
      {state !== 'form' && state !== 'prep' && (
        <>
          <button type="button" onClick={pick} disabled={state === 'busy'} className="protocol-action w-full disabled:opacity-40">
            <FileScan size={20} aria-hidden />{state === 'busy' ? L.busy : L.button}</button>
          {state === 'none' && <p className="px-1 text-sm leading-relaxed text-muted">{L.hint}</p>}
        </>
      )}
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void read([...(e.target.files ?? [])])} />
      {state === 'demo' && <p className="text-sm text-muted">{L.demo}</p>}
      {state === 'consent' && (
        <div className="protocol-card space-y-3 p-4 text-sm leading-relaxed">
          <p>{L.consent}</p>
          <button type="button" onClick={() => void allow()} className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.allow}</button>
        </div>
      )}
      {state === 'form' && (
        <section aria-label={L.check} aria-busy={saving} className="space-y-4">
          <div className="protocol-card space-y-3 border-accent/30 p-4 sm:p-5">
            <p className="protocol-eyebrow flex items-center gap-2"><ShieldCheck size={16} aria-hidden />{L.draft}</p>
            <h2 className="text-xl font-semibold leading-snug">{L.check}</h2>
            <p className="text-sm text-muted">{L.from(source)}</p>
            <p className="text-sm leading-relaxed text-muted">{L.reviewHint}</p>
            {reviewCount > 0 && <p className="rounded-xl bg-warn-bg p-3 text-sm text-warn">{L.reviewCount(reviewCount)}</p>}
            {note && <p className="text-sm text-warn">{note}</p>}
          </div>
          <fieldset disabled={saving} className="min-w-0 space-y-4">
            {bulk.length > 1 && (
              <button type="button" onClick={() => setOn((s) => { const n = new Set(s); for (const l of bulk) { if (allOn) n.delete(l.key); else n.add(l.key); } return n; })}
                className="min-h-tap text-sm text-accent underline">{allOn ? L.none : L.all}</button>
            )}
            {GROUPS.map((g) => {
              const ls = lines.filter((l) => groupOf(l) === g);
              if (!ls.length) return null;
              return (
                <div key={g} className="protocol-card p-4 sm:p-5">
                  <h3 className="mb-1 text-lg font-semibold">{L.groups[g]} <span className="text-sm font-normal text-muted">· {ls.length}</span></h3>
                  {g === 'meds' && <p className="text-xs text-muted">{L.medsOneByOne}</p>}
                  <ul className="divide-y divide-line">
                    {ls.map((l) => {
                      const lack = missing(l);
                      const body = (
                        <span className="min-w-0 flex-1">
                          <LineText line={l} plan={plan} known={!!index} change={diff.get(l.key)} />
                          <Status line={l} />
                          {lack && <span className="block text-sm text-warn">{lack === 'dose' ? L.needDose : L.needTime}</span>}
                          {cuts[l.key] && <img src={cuts[l.key]} alt={L.piece} className="mt-2 max-h-32 max-w-full rounded-xl border border-line" />}
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
                          {onboarding && isMed(l) && !on.has(l.key) && (
                            <button type="button" onClick={() => flip(l.key)} aria-pressed={skip.has(l.key)}
                              className="mb-2 ml-8 min-h-[2rem] rounded-full border border-line px-3 text-xs">{skip.has(l.key) ? `${L.skippedMed} · ${L.unskipMed}` : L.skipMed}</button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {gone.length > 0 && ( /* D115: never closed silently — another doctor's paper does not cancel them */
              <div className="protocol-card p-4 sm:p-5">
                <h3 className="mb-1 text-lg font-semibold">{L.gone}</h3>
                <p className="text-xs text-muted">{L.goneHint}</p>
                <ul className="divide-y divide-line">
                  {gone.map((p) => (
                    <li key={p.id}><label className="flex min-h-tap items-start gap-3 py-2">
                      <input type="checkbox" checked={close.has(p.id)} aria-label={L.closeAria(p.title)} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--accent))]"
                        onChange={() => setClose((x) => { const n = new Set(x); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
                      <span><span className="font-medium">{p.title}</span>{p.dose && ` · ${p.dose}`}<span className="block text-sm text-muted">{L.close}</span></span>
                    </label></li>
                  ))}
                </ul>
              </div>
            )}
          </fieldset>
          {undecided > 0 && <p role="status" className="text-sm text-warn">{L.undecided(undecided)}</p>}
          <div data-testid="plan-review-actions" className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 rounded-2xl border border-line bg-surface p-3 shadow-lg md:bottom-4">
            <p aria-live="polite" aria-atomic="true" className="mb-2 text-sm text-muted">{L.selected(on.size, close.size)}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={saving || (!on.size && !close.size) || undecided > 0} onClick={() => void save()}
                className="protocol-action flex-1 disabled:opacity-40">{saving ? L.saving : onboarding ? L.start(on.size) : L.save(on.size + close.size)}</button>
              <button type="button" disabled={saving} onClick={() => { setState('none'); setLines([]); setCuts({}); }} className="protocol-action-secondary disabled:opacity-40">{t.meal.cancel}</button>
            </div>
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

function LineText({ line: l, plan, known, change }: { line: DraftLine; plan: PlanRow; known: boolean; change?: Change }) {
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
    if (p.kind === 'test') return <span><span className="font-medium">{p.title}</span>{exists && updates}
      <span className="block text-sm text-muted">{[P.kinds.test, p.dueDate ? L.dueBy(day(p.dueDate)) + (l.suggestedDate ? ` (${L.suggestedDate})` : '') : ''].filter(Boolean).join(' · ')}</span></span>;
    const when = !drug ? '' : [p.asNeeded ? L.asNeeded : p.schedule?.times.length ? p.schedule.times.join(', ') + (l.suggested ? ` (${L.suggested})` : '') : '',
      p.schedule?.withFood === true ? L.withFood : p.schedule?.withFood === false ? L.empty : '',
      p.until ? L.until(format(parseISO(p.until), 'd.MM')) : ''].filter(Boolean).join(' · ');
    const badge = change?.kind === 'new' ? <span className="text-xs text-accent"> · {L.isNew}</span> // D115
      : change?.kind === 'changed' ? <span className="block text-xs text-warn">{L.changed(change.was)}</span>
      : change?.kind === 'same' ? <span className="text-xs text-muted"> · {L.same}</span> : exists && updates;
    return <span><span className="font-medium">{p.title}</span>{p.dose && ` · ${p.dose}`}{badge}
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
