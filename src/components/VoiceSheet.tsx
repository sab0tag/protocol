// D95: the voice window (M5) — one place to say a meal, a medicine or water. It listens as soon as it opens, shows a
// draft (the same reading and plan check as everywhere), asks the quantities nobody said, takes commands on the draft
// («прибери каву», «хліба було 40 грамів», «як учора»), and writes it all with one tap — the same records the day's
// buttons make, with fixed ids so a second tap never doubles them. The seconds from opening to writing stay on the device.
// D105: what was said lands in the field, where it can be corrected; the draft is read from the field as it is (nothing
// is lost if the phone never marks the speech final), «Записати» writes what is shown. «Це все» at the end stops listening.
import { format } from 'date-fns';
import { Mic, Square, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db, inDemo } from '../data/db';
import { listen, speechSupported, type SpeechError } from '../data/speech';
import { atLocal, newId } from '../domain/dates';
import { amountText, needsGrams, approxG } from '../domain/foodSearch';
import { dishItem, setPortions } from '../domain/recipes';
import { evaluate } from '../domain/evaluate';
import { useRecentEntries } from '../data/queries';
import { answerSame, change, emptyDraft, newSession, ready, step, type DraftMed, type VoiceDraft, type VoiceSession } from '../domain/voice';
import type { DayEntry, Food, MealItem, Plan, Recipe } from '../domain/types';
import { t } from '../i18n/uk';
import { ConciergeNotFound } from './ConciergeNotFound';
import { DangerCard } from './DangerCard';
import { dangerInText } from '../domain/symptoms';
import { Sheet } from './Sheet';
import { saved } from './Toast';
import { countOnce } from '../data/tally';

const L = t.voice;
const C = t.voice.cmd;
const OK_KEY = 'protocol.voice.ok', METRIC_KEY = `protocol.metrics.voice${inDemo() ? '.demo' : ''}`; // D98: the pilot's measure from own use only
const okGiven = () => { try { return localStorage.getItem(OK_KEY) === '1'; } catch { return false; } };

/** D95: seconds from opening the window to writing — the pilot's measure; the last 50, on this device only. */
export function voiceSeconds(): number[] {
  try { return JSON.parse(localStorage.getItem(METRIC_KEY) ?? '[]') as number[]; } catch { return []; }
}
const remember = (s: number) => { try { localStorage.setItem(METRIC_KEY, JSON.stringify([...voiceSeconds(), s].slice(-50))); } catch { /* private mode */ } };

/** What to pick when nobody said how much: a dish — its portions, a food with a measure — that measure, else grams. */
const options = (it: MealItem): MealItem[] => it.recipe ? [0.5, 1, 1.5, 2].map((q) => setPortions(it, q))
  : it.unit ? [0.5, 1, 1.5, 2].map((q) => ({ ...it, grams: Math.round(q * it.unit!.grams), unit: { ...it.unit!, qty: q } }))
  : [100, 150, 200, 300].map((g) => ({ ...it, grams: g }));

export function VoiceSheet({ date, plan, foods, recipes, today, yesterday, meds, onClose }: {
  date: string; plan: Plan | undefined; foods: Map<string, Food>; recipes: Recipe[]; today: DayEntry[]; yesterday: DayEntry[];
  meds: DraftMed[]; onClose: () => void;
}) {
  const recent = useRecentEntries(date, 8); // R03: the day and the week before it
  const opened = useRef(Date.now());
  const ids = useRef({ meal: newId(), water: newId(), meds: new Map<string, string>() }); // fixed: a second tap writes the same rows
  const [ok, setOk] = useState(okGiven);
  const [session, setSession] = useState<VoiceSession>(newSession); // what is taken in (D107: with its history); the field's words go on top of it
  const [heard, setHeard] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SpeechError | null>(null);
  const [typed, setTyped] = useState('');
  const [time, setTime] = useState(() => format(new Date(), 'HH:mm'));
  const [saving, setSaving] = useState(false);
  const stop = useRef<() => void>(() => undefined);
  const said = useRef<string[]>([]); // D107: what was heard before — a recogniser may glue it to the new words
  const ctx = useMemo(() => ({ foods: [...foods.values()], recipes, dishItem, prescriptions: plan?.prescriptions ?? [], yesterday,
    meds: meds.filter((m) => !today.some((e) => e.checkKey === m.key && e.status === 'done')) }), [foods, recipes, plan, yesterday, meds, today]);

  // the field is read as it is, on top of what is already in the draft; an action on the draft takes the field in first
  const now = useMemo(() => (typed.trim() ? step(session, typed, ctx) : session), [typed, session, ctx]);
  const shown = now.draft;
  const commit = () => { setSession(now); setTyped(''); };
  const edit = (fn: (d: VoiceDraft) => VoiceDraft, note?: string) => { setSession(change(now, fn(now.draft), note)); setTyped(''); };
  const undo = () => { const prev = now.history.at(-1); if (prev) setSession({ draft: prev, history: now.history.slice(0, -1), note: C.undone }); setTyped(''); };
  const start = () => {
    if (typed.trim()) commit(); // the next words are more of the meal or a command on it
    setError(null); setHeard(''); setBusy(true);
    stop.current = listen({ interim: setHeard, final: (x, heard) => { said.current.push(heard); setHeard(''); setTyped(x); }, error: setError, end: () => setBusy(false) },
      said.current);
  };
  useEffect(() => { if (ok && speechSupported()) start(); return () => stop.current(); }, [ok]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const draft = shown;
    if (!ready(draft) || saving) return;
    setSaving(true);
    const at = atLocal(date, time), rows: DayEntry[] = [];
    if (draft.items.length) rows.push({ id: ids.current.meal, at, kind: 'meal', status: 'done', title: draft.title ?? defaultTitle(time), items: draft.items.map((x) => x.item), via: 'voice' }); // D119
    for (const m of draft.meds) {
      const id = ids.current.meds.get(m.key) ?? newId(); ids.current.meds.set(m.key, id);
      rows.push({ id, at, kind: 'med', status: 'done', title: m.title, checkKey: m.key, ...(m.prescriptionId ? { prescriptionId: m.prescriptionId } : {}) });
    }
    if (draft.waterMl) rows.push({ id: ids.current.water, at, kind: 'water', status: 'done', title: t.addKinds.water, waterMl: draft.waterMl });
    const done = await saved(db.entries.bulkPut(rows).then(() => true), L.saved, () => db.entries.bulkDelete(rows.map((r) => r.id)));
    setSaving(false);
    if (done) { remember(Math.round((Date.now() - opened.current) / 1000)); onClose(); }
  };
  const setItem = (i: number, it: MealItem | null) => edit((d) => ({ ...d, items: it ? d.items.map((x, j) => (j === i ? { ...x, item: it, sure: true } : x)) : d.items.filter((_, j) => j !== i) }));
  const draft = shown;
  // D119: a part of a phrase the base does not know — counted once the draft has settled, not letter by letter
  const nf = draft.notFound.join('\n');
  useEffect(() => {
    if (!nf) return undefined;
    const timer = setTimeout(() => { for (const x of nf.split('\n')) void countOnce('nf', x); }, 1500);
    return () => clearTimeout(timer);
  }, [nf]);
  const partAsk = now.ask?.kind === 'part' ? now.ask : undefined;
  const danger = dangerInText(heard) || dangerInText(typed) || draft.notFound.some(dangerInText); // D97: one 103 card, nothing else about those words
  // R03: what is said is eaten — judged against the day's eaten food and the week before (the liver once a week too)
  const checks = plan && draft.items.length ? evaluate({ plan, date, foods, entries: recent ?? today, intent: 'recorded', meal: draft.items.map((x) => x.item) }).checks : [];

  if (!ok) return (
    <Sheet title={L.title} onClose={onClose}>
      <p className="text-sm">{L.consent}</p>
      <button type="button" onClick={() => { try { localStorage.setItem(OK_KEY, '1'); } catch { /* private */ } setOk(true); }}
        className="mt-3 min-h-tap w-full rounded-xl bg-accent px-4 font-medium text-surface">{L.consentOk}</button>
    </Sheet>
  );

  const empty = !draft.items.length && !draft.meds.length && !draft.waterMl && !draft.notFound.length;
  return (
    <Sheet title={L.title} onClose={onClose}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => (busy ? stop.current() : start())} aria-label={busy ? L.listening : empty ? L.listen : L.again}
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${busy ? 'animate-pulse bg-warn text-surface' : 'bg-accent text-surface'}`}>
          {busy ? <Square size={22} aria-hidden /> : <Mic size={24} aria-hidden />}</button>
        <p role="status" className="min-h-[3rem] flex-1 text-sm">{busy ? heard || L.listening : empty ? L.hint : L.more}</p>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-warn">{L.errors[error]}</p>}
      {danger && <DangerCard />}
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); commit(); }}>
        <label className="flex-1"><span className="sr-only">{L.typed}</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={L.typedPh} className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
        <button type="submit" className="min-h-tap rounded-xl border border-accent px-3 text-accent">{L.apply}</button>
      </form>

      {now.ask?.kind === 'same' && ( /* D107: the same food said again — one more lot, or the amount now */
        <div role="group" aria-label={C.same(now.ask.item.name, amountText(shown.items[now.ask.index]!.item))} className="mt-3 space-y-2 rounded-xl border border-warn/40 p-2 text-sm">
          <p>{C.same(now.ask.item.name, amountText(shown.items[now.ask.index]!.item))}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="min-h-tap rounded-xl border border-line px-3" onClick={() => { setSession(answerSame(now, true)); setTyped(''); }}>{C.sameMore(amountText(now.ask.item))}</button>
            <button type="button" className="min-h-tap rounded-xl border border-line px-3" onClick={() => { setSession(answerSame(now, false)); setTyped(''); }}>{C.sameNow(amountText(now.ask.item))}</button>
          </div>
        </div>
      )}
      {partAsk && ( /* D107: a part of a dish — the whole dish, or the dish without it; never guessed */
        <div role="group" aria-label={C.ask(partAsk.part, partAsk.whole)} data-ask="part" className="mt-3 space-y-2 rounded-xl border border-warn/40 p-2 text-sm">
          <p>{C.ask(partAsk.part, partAsk.whole)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="min-h-tap rounded-xl border border-line px-3" onClick={() => { const a = partAsk; edit((d) => ({ ...d, items: d.items.filter((_, j) => j !== a.index) }), C.removed(a.whole)); }}>{C.askWhole(partAsk.whole)}</button>
            {partAsk.instead && <button type="button" className="min-h-tap rounded-xl border border-line px-3" onClick={() => { const a = partAsk;
              edit((d) => ({ ...d, items: d.items.map((x, j) => (j === a.index ? { item: a.instead!, said: a.part, sure: false } : x)) }), C.replaced(a.whole, a.instead!.name)); }}>{C.askInstead(partAsk.instead.name)}</button>}
            <button type="button" className="min-h-tap rounded-xl border border-line px-3" onClick={() => { setSession({ draft: now.draft, history: now.history }); setTyped(''); }}>{C.askKeep}</button>
          </div>
        </div>
      )}
      {now.confirmClear && (
        <div role="group" aria-label={C.clear} className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 p-2 text-sm">
          <span className="flex-1">{C.clear}</span>
          <button type="button" className="min-h-tap rounded-xl border border-warn px-3" onClick={() => edit(() => emptyDraft(), C.cleared)}>{C.clearYes}</button>
          <button type="button" className="min-h-tap rounded-xl border border-line px-3" onClick={() => { setSession({ draft: now.draft, history: now.history }); setTyped(''); }}>{C.clearNo}</button>
        </div>
      )}
      {now.note && ( /* D107: what the last command did — so a wrong reading is seen, with a way back */
        <p role="status" className="mt-2 flex items-center gap-2 text-sm"><span className="flex-1 text-muted">{now.note}</span>
          {now.history.length > 0 && now.note !== C.undone && <button type="button" onClick={undo} className="min-h-[2rem] px-1 text-accent underline">{C.undo}</button>}</p>
      )}
      {!empty && (
        <div className="mt-3 space-y-3" aria-label={L.meal}>
          {(draft.items.length > 0 || draft.notFound.length > 0) && (
            <div className="space-y-2 rounded-xl border border-line p-2">
              <div className="flex flex-wrap items-center gap-2">
                {t.meal.names.map((n) => (
                  <button key={n} type="button" aria-pressed={(draft.title ?? defaultTitle(time)) === n} onClick={() => edit((d) => ({ ...d, title: n }))}
                    className={`min-h-[2.25rem] rounded-full border px-3 text-sm ${(draft.title ?? defaultTitle(time)) === n ? 'border-accent bg-accent/10 text-accent' : 'border-line'}`}>{n}</button>
                ))}
                <label className="ml-auto text-sm"><span className="sr-only">{L.time}</span>
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="min-h-[2.25rem] rounded-lg border border-line bg-bg px-2" /></label>
              </div>
              {shown.items.filter((x) => !x.sure).length > 1 && ( /* D109: one tap for all, instead of one per line */
                <button type="button" onClick={() => edit((d) => ({ ...d, items: d.items.map((x) => (x.sure ? x : { ...x, item: options(x.item)[1]!, sure: true })) }), L.allUsualDone)}
                  className="min-h-[2.25rem] rounded-full border border-accent px-3 text-sm text-accent">{L.allUsual}</button>
              )}
              <ul className="space-y-2">
                {draft.items.map((x, i) => {
                  const hits = checks[i]?.hits ?? [];
                  return (
                    <li key={i} data-item={x.item.name} className="rounded-lg bg-bg p-2 text-sm">
                      <div className="flex items-start gap-2">
                        <span className="flex-1"><span className="font-medium">{x.item.name}</span>
                          {x.sure /* D109: an amount nobody said is not shown as if it were — «1 порція» beside «не названо» read as recorded */
                            ? <span className="text-muted"> · {amountText(x.item)}{needsGrams(x.item) ? ` ≈ ${approxG(x.item.grams)} г` : ''}</span>
                            : <span className="text-warn"> · {L.noAmount}</span>}</span>
                        <button type="button" onClick={() => setItem(i, null)} aria-label={`${t.meal.remove}: ${x.item.name}`} className="flex h-8 w-8 items-center justify-center text-muted"><X size={16} aria-hidden /></button>
                      </div>
                      {hits.length > 0 && <p className="text-xs text-warn">{[...new Set(hits.map((h) => h.message))].join(' · ')}</p>}
                      {!x.sure && (
                        <div className="mt-1 flex flex-wrap items-center gap-1" role="group" aria-label={`${L.unsure} ${x.item.name}`}>
                          <span className="text-xs text-warn">{L.unsure}</span>
                          {options(x.item).map((o) => (
                            <button key={o.grams} type="button" onClick={() => setItem(i, o)} className="min-h-[2.25rem] rounded-full border border-line px-2 text-xs">{amountText(o)}</button>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!danger && draft.notFound.map((text) => (
                <div key={text} className="text-sm">
                  <p className="flex items-start gap-2"><span className="flex-1 text-warn">«{text}» — {t.meal.notFound}</span>
                    <button type="button" onClick={() => edit((d) => ({ ...d, notFound: d.notFound.filter((n) => n !== text) }))}
                      className="min-h-[2rem] px-1 text-muted underline">{L.drop}</button></p>
                  <ConciergeNotFound text={text} plan={plan} foods={foods} recipes={recipes} date={date}
                    onAdd={(s) => edit((d) => ({ ...d, notFound: d.notFound.filter((n) => n !== text), items: [...d.items, { item: s.item, said: text, sure: true }] }))} /></div>
              ))}
            </div>
          )}
          {draft.meds.length > 0 && (
            <p className="rounded-xl border border-line p-2 text-sm">{L.meds}: {draft.meds.map((m) => m.title).join(', ')} · {time}</p>
          )}
          {draft.waterMl > 0 && <p className="rounded-xl border border-line p-2 text-sm">{L.water(draft.waterMl)}</p>}
        </div>
      )}

      {draft.notFound.length > 0 && !danger && <p className="mt-3 text-sm text-warn">{L.unread(draft.notFound.length)}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={!ready(draft) || saving} onClick={() => void save()}
          className="min-h-tap flex-1 rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">{L.save}</button>
        <button type="button" onClick={onClose} className="min-h-tap rounded-xl border border-line px-4">{L.cancel}</button>
      </div>
    </Sheet>
  );
}

function defaultTitle(time: string): string {
  const h = Number(time.slice(0, 2));
  return h < 11 ? t.meal.names[0] : h < 16 ? t.meal.names[1] : t.meal.names[2];
}
