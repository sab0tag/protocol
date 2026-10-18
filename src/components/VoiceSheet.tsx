// D95: the voice window (M5) — one place to say a meal, a medicine or water. It listens as soon as it opens, shows a
// draft (the same reading and plan check as everywhere), asks the quantities nobody said, takes commands on the draft
// («прибери каву», «хліба було 40 грамів», «як учора»), and writes it all with one tap — the same records the day's
// buttons make, with fixed ids so a second tap never doubles them. The seconds from opening to writing stay on the device.
import { format } from 'date-fns';
import { Mic, Square, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db, inDemo } from '../data/db';
import { listen, speechSupported, type SpeechError } from '../data/speech';
import { atLocal, newId } from '../domain/dates';
import { amountText, approxG } from '../domain/foodSearch';
import { dishItem, setPortions } from '../domain/recipes';
import { checkMeal } from '../domain/rules';
import { emptyDraft, hear, ready, type DraftMed, type VoiceDraft } from '../domain/voice';
import type { DayEntry, Food, MealItem, Plan, Recipe } from '../domain/types';
import { t } from '../i18n/uk';
import { ConciergeNotFound } from './ConciergeNotFound';
import { DangerCard } from './DangerCard';
import { dangerInText } from '../domain/symptoms';
import { Sheet } from './Sheet';
import { saved } from './Toast';

const L = t.voice;
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
  const opened = useRef(Date.now());
  const ids = useRef({ meal: newId(), water: newId(), meds: new Map<string, string>() }); // fixed: a second tap writes the same rows
  const [ok, setOk] = useState(okGiven);
  const [draft, setDraft] = useState<VoiceDraft>(emptyDraft);
  const [heard, setHeard] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SpeechError | null>(null);
  const [typed, setTyped] = useState('');
  const [time, setTime] = useState(() => format(new Date(), 'HH:mm'));
  const [saving, setSaving] = useState(false);
  const stop = useRef<() => void>(() => undefined);
  const ctx = useMemo(() => ({ foods: [...foods.values()], recipes, dishItem, prescriptions: plan?.prescriptions ?? [], yesterday,
    meds: meds.filter((m) => !today.some((e) => e.checkKey === m.key && e.status === 'done')) }), [foods, recipes, plan, yesterday, meds, today]);

  const take = (text: string) => { if (text.trim()) setDraft((d) => hear(text, d, ctx)); };
  const start = () => {
    setError(null); setHeard(''); setBusy(true);
    stop.current = listen({ interim: setHeard, final: (x) => { setHeard(x); take(x); }, error: setError, end: () => setBusy(false) });
  };
  useEffect(() => { if (ok && speechSupported()) start(); return () => stop.current(); }, [ok]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!ready(draft) || saving) return;
    setSaving(true);
    const at = atLocal(date, time), rows: DayEntry[] = [];
    if (draft.items.length) rows.push({ id: ids.current.meal, at, kind: 'meal', status: 'done', title: draft.title ?? defaultTitle(time), items: draft.items.map((x) => x.item) });
    for (const m of draft.meds) {
      const id = ids.current.meds.get(m.key) ?? newId(); ids.current.meds.set(m.key, id);
      rows.push({ id, at, kind: 'med', status: 'done', title: m.title, checkKey: m.key, ...(m.prescriptionId ? { prescriptionId: m.prescriptionId } : {}) });
    }
    if (draft.waterMl) rows.push({ id: ids.current.water, at, kind: 'water', status: 'done', title: t.addKinds.water, waterMl: draft.waterMl });
    const done = await saved(db.entries.bulkPut(rows).then(() => true), L.saved, () => db.entries.bulkDelete(rows.map((r) => r.id)));
    setSaving(false);
    if (done) { remember(Math.round((Date.now() - opened.current) / 1000)); onClose(); }
  };
  const setItem = (i: number, it: MealItem | null) => setDraft((d) => ({ ...d, items: it ? d.items.map((x, j) => (j === i ? { ...x, item: it, sure: true } : x)) : d.items.filter((_, j) => j !== i) }));
  const danger = dangerInText(heard) || draft.notFound.some(dangerInText); // D97: one 103 card, nothing else about those words
  const checks = plan && draft.items.length ? checkMeal({ plan, date, foods, dayEntries: today, recentEntries: [], meal: draft.items.map((x) => x.item) }) : [];

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
        <p role="status" className="min-h-[3rem] flex-1 text-sm">{heard || (busy ? L.listening : empty ? L.hint : '')}</p>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-warn">{L.errors[error]}</p>}
      {danger && <DangerCard />}
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); take(typed); setTyped(''); }}>
        <label className="flex-1"><span className="sr-only">{L.typed}</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={L.typedPh} className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
        <button type="submit" className="min-h-tap rounded-xl border border-accent px-3 text-accent">{L.apply}</button>
      </form>

      {!empty && (
        <div className="mt-3 space-y-3" aria-label={L.meal}>
          {(draft.items.length > 0 || draft.notFound.length > 0) && (
            <div className="space-y-2 rounded-xl border border-line p-2">
              <div className="flex flex-wrap items-center gap-2">
                {t.meal.names.map((n) => (
                  <button key={n} type="button" aria-pressed={(draft.title ?? defaultTitle(time)) === n} onClick={() => setDraft((d) => ({ ...d, title: n }))}
                    className={`min-h-[2.25rem] rounded-full border px-3 text-sm ${(draft.title ?? defaultTitle(time)) === n ? 'border-accent bg-accent/10 text-accent' : 'border-line'}`}>{n}</button>
                ))}
                <label className="ml-auto text-sm"><span className="sr-only">{L.time}</span>
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="min-h-[2.25rem] rounded-lg border border-line bg-bg px-2" /></label>
              </div>
              <ul className="space-y-2">
                {draft.items.map((x, i) => {
                  const hits = checks[i]?.hits ?? [];
                  return (
                    <li key={i} data-item={x.item.name} className="rounded-lg bg-bg p-2 text-sm">
                      <div className="flex items-start gap-2">
                        <span className="flex-1"><span className="font-medium">{x.item.name}</span>
                          <span className="text-muted"> · {amountText(x.item)}{x.item.unit || x.item.recipe ? ` ≈ ${approxG(x.item.grams)} г` : ''}</span></span>
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
                    <button type="button" onClick={() => setDraft((d) => ({ ...d, notFound: d.notFound.filter((n) => n !== text) }))}
                      className="min-h-[2rem] px-1 text-muted underline">{L.drop}</button></p>
                  <ConciergeNotFound text={text} plan={plan} foods={foods} recipes={recipes} date={date}
                    onAdd={(s) => setDraft((d) => ({ ...d, notFound: d.notFound.filter((n) => n !== text), items: [...d.items, { item: s.item, said: text, sure: true }] }))} /></div>
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
