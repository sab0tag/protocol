// D162: «Скажіть або напишіть…» at the bottom of «Сьогодні» — one line instead of four ways in. What a phrase is, the code
// decides (readOneInput); a card shows what will happen, and only water is written at once (with «Скасувати»). A medicine is
// marked only after «Так». Danger and crisis words show their card and nothing else. A question is answered here, the way
// «Помічник» answers it (D166); the talk goes to «Ще → Помічник», not into a feed here. After an action the card goes — its
// result is in the day's list.
import { format } from 'date-fns';
import { Camera, Mic, Send, Square, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { answer, assistantConsented, eveningSnack, giveAssistantConsent, keepTalk, talkOf, type Answer } from '../app/assistantAnswer';
import { applyLightDay } from '../app/lightDay';
import { db } from '../data/db';
import { listen, speechSupported, type SpeechError } from '../data/speech';
import { count } from '../data/tally';
import { brings } from '../domain/assistant';
import type { CheckItem } from '../domain/checklist';
import { atLocal, newId } from '../domain/dates';
import type { FeatureId } from '../domain/features';
import { amountText } from '../domain/foodSearch';
import { frequentItems } from '../domain/habits';
import { slotAt } from '../domain/mealSlots';
import { readOneInput, type DueMed, type OneInput as Reading } from '../domain/oneInput';
import { dishItem } from '../domain/recipes';
import type { DayEntry, Food, MealItem, Plan, Recipe } from '../domain/types';
import type { VoiceDraft } from '../domain/voice';
import type { TileDraft } from './MealTiles';
import { t } from '../i18n/uk';
import { CrisisCard } from './CrisisCard';
import { DangerCard } from './DangerCard';
import { markMeds } from './MarkTime';
import { PhotoStatus, usePlatePhoto } from './PlatePhoto';
import { saved, toast } from './Toast';
import { giveVoiceOk, okGiven } from './VoiceSheet';

const L = t.one;
const dayRows = (date: string) => db.entries.where('at').startsWith(`${date}T`).toArray();
const same = (a: DayEntry, b: DayEntry) => JSON.stringify(a) === JSON.stringify(b);

/** «Скасуй останнє»: what the field's last action added or changed that day goes back as it was. */
async function snapshot(date: string, act: () => Promise<unknown>): Promise<() => Promise<void>> {
  const before = await dayRows(date);
  await act();
  const after = await dayRows(date);
  const was = new Map(before.map((e) => [e.id, e]));
  const added = after.filter((e) => !was.has(e.id)).map((e) => e.id);
  const changed = after.flatMap((e) => { const old = was.get(e.id); return old && !same(old, e) ? [old] : []; });
  return async () => { await db.entries.bulkDelete(added); await db.entries.bulkPut(changed); };
}

export function dueMeds(items: CheckItem[], plan: Plan | undefined): { open: DueMed[]; taken: DueMed[] } {
  const aliases = new Map((plan?.prescriptions ?? []).map((p) => [p.id, [p.med?.name, p.med?.inn].filter((x): x is string => !!x)]));
  const one = (i: CheckItem): DueMed => ({ key: i.key, title: i.title, ...(i.time ? { time: i.time } : {}), ...(i.prescriptionId ? { prescriptionId: i.prescriptionId, aliases: aliases.get(i.prescriptionId) ?? [] } : {}) });
  const meds = items.filter((i) => i.kind === 'med');
  return { open: meds.filter((i) => !i.done && !i.skipped).map(one), taken: meds.filter((i) => i.done).map(one) };
}

/** Food said here lands in the tile of the meal going on now, opened with a draft (spec: «попадает в плитку текущего приёма»). */
export type OnFood = (draft: TileDraft) => void;

export function OneInput({ date, plan, foods, recipes, all, medItems, can, lightDay, onFood }: {
  date: string; plan: Plan | undefined; foods: Map<string, Food>; recipes: Recipe[]; all: DayEntry[]; medItems: CheckItem[];
  can: (feature: FeatureId) => boolean; lightDay: boolean; onFood: OnFood;
}) {
  const [text, setText] = useState('');
  const [card, setCard] = useState<Reading | null>(null);
  const [food, setFood] = useState<VoiceDraft | null>(null); // the food card stays for edits («прибери курку») until written
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const [error, setError] = useState<SpeechError | null>(null);
  const [talk, setTalk] = useState<{ q: string; a?: Answer } | null>(null); // a question and its answer, while it is on screen
  const asked = useRef(0); // D130: an answer to a question closed or replaced since does not land
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const undo = useRef<(() => Promise<void>) | null>(null);
  const listened = useRef(false); // the words came by voice (D119)
  const stop = useRef<() => void>(() => undefined);
  useEffect(() => () => stop.current(), []);
  const { open, taken } = useMemo(() => dueMeds(medItems, plan), [medItems, plan]);
  const usual = useMemo(() => new Set(frequentItems(all, date, 60, 50).map((f) => f.item.recipe?.id ?? f.item.foodId ?? '')), [all, date]);
  const { photo, setPhoto, pick, allow, fileInput } = usePlatePhoto({ foods, recipes, usual });
  const slot = slotAt(new Date());
  const meal = t.meal.names[slot]!;

  const act = async (work: () => Promise<unknown>) => { undo.current = await snapshot(date, work); setCard(null); setFood(null); setText(''); };
  const closeTalk = () => { asked.current += 1; setTalk(null); };
  const day = plan ? { plan, foods, recipes, all, date } : undefined;
  const askNow = async (q: string, consent = assistantConsented(!!meta?.conciergeConsent)) => {
    if (!day) return;
    const n = ++asked.current;
    setText(''); setCard(null); setFood(null); setTalk({ q });
    const before = talkOf(date);
    const a = await answer(q, day, { consent, log: !!meta?.conciergeLog, history: before });
    if (n !== asked.current) return;
    setTalk({ q, a });
    // the day's talk on «Помічник»: a card clears it (D130 — those words are never kept or sent again)
    if ('card' in a) keepTalk(date, [{ id: newId(), role: 'assistant', text: '', card: a.card }]);
    else if (!('consent' in a)) keepTalk(date, [...before, { id: newId(), role: 'user', text: q }, { id: newId(), role: 'assistant', ...a }]);
  };
  const toEvening = async (it: MealItem) => { // a planned snack for the evening — never what was eaten (boundary 5)
    if (!day) return;
    const e = eveningSnack(it, day);
    if (!e) { toast(t.assistant.changed(it.name)); return; }
    closeTalk();
    await saved(db.entries.add(e), t.topup.planned(it.name), () => db.entries.delete(e.id));
    void count('topup_taken'); // D119
  };
  const read = (said: string) => {
    const r = readOneInput(said, { foods: [...foods.values()], recipes, dishItem, prefer: usual, prescriptions: plan?.prescriptions ?? [], yesterday: [],
      meds: can('meds.log') ? open : [], taken, now: format(new Date(), 'HH:mm'), assistant: can('assistant.chat'), ...(food ? { card: food } : {}) });
    if (r.kind === 'empty') return;
    if (r.kind === 'undo') {
      const back = undo.current;
      undo.current = null;
      if (back) void saved(back(), L.undone); else toast(L.nothingToUndo);
      setText(''); return;
    }
    if (r.kind === 'water') {
      if (!can('water.log')) { setCard(r); return; }
      const e: DayEntry = { id: newId(), at: atLocal(date, format(new Date(), 'HH:mm')), kind: 'water', status: 'done', title: t.addKinds.water, waterMl: r.ml };
      void act(() => saved(db.entries.add(e), L.water(r.ml), () => db.entries.delete(e.id)));
      return;
    }
    if (r.kind === 'food' || r.kind === 'edit') { toTile(r.draft); return; }
    if (r.kind === 'question') { void askNow(r.text); return; }
    closeTalk(); setCard(r);
  };
  const submit = () => { if (text.trim()) read(text); };
  const listenNow = () => {
    if (!okGiven()) { setAsk(true); return; }
    setAsk(false); setError(null); setBusy(true);
    stop.current = listen({ interim: setText, final: (x) => { listened.current = true; setText(x); read(x); }, error: setError, end: () => setBusy(false) });
  };
  const markYes = (meds: DueMed[]) => act(async () => {
    const groups = new Map<string, DueMed[]>();
    for (const m of meds) groups.set(m.time ?? '', [...(groups.get(m.time ?? '') ?? []), m]);
    for (const [time, ms] of groups) await markMeds(ms.map((m) => ({ key: m.key, title: m.title, ...(m.prescriptionId ? { prescriptionId: m.prescriptionId } : {}) })),
      date, time || undefined, 'done', { time: format(new Date(), 'HH:mm') });
  });
  // the food goes to the tile as a draft; the field keeps it for «прибери …» until the tile writes it. Water said with it
  // («два яйця і склянка води») is written at once, as water alone is.
  const toTile = (draft: VoiceDraft) => {
    setText('');
    if (!can('food.log')) { setCard({ kind: 'food', draft }); return; }
    const water = draft.waterMl - (food?.waterMl ?? 0);
    if (water > 0 && can('water.log')) {
      const e: DayEntry = { id: newId(), at: atLocal(date, format(new Date(), 'HH:mm')), kind: 'water', status: 'done', title: t.addKinds.water, waterMl: water };
      void act(() => saved(db.entries.add(e), L.water(water), () => db.entries.delete(e.id)));
    }
    setFood(draft); setCard(null);
    onFood({ rows: [...draft.items.map((x) => ({ text: x.said, item: x.item, ...(x.others ? { others: x.others } : {}) })), ...draft.notFound.map((x) => ({ text: x }))],
      ...(listened.current ? { via: 'voice' as const } : {}) });
  };

  return (
    <section aria-label={L.field} className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 mb-4 space-y-2 md:bottom-4" data-testid="one-input">
      {card && <Card card={card} meal={meal} can={can} lightDay={lightDay} onClose={() => { setCard(null); setFood(null); }}
        onMeds={(m) => void markYes(m)} onWhich={(m) => setCard({ kind: 'meds', meds: [m] })}
        onLightDay={() => void act(() => applyLightDay(true, 'voice'))} onFood={toTile} />}
      {talk && <AnswerCard talk={talk} foods={foods} onClose={closeTalk} onEvening={(it) => void toEvening(it)}
        onConsent={() => { giveAssistantConsent(); void askNow(talk.q, true); }} />}
      <PhotoStatus photo={photo} allow={allow} />
      {photo.state === 'done' && photo.rows.length > 0 && !card && (() => {
        const draft: VoiceDraft = { items: photo.rows.flatMap((r) => (r.item ? [{ item: r.item, said: r.text, sure: true }] : [])), notFound: photo.rows.filter((r) => !r.item).map((r) => r.text), meds: [], waterMl: 0 };
        return <Card card={{ kind: 'food', draft }} meal={meal} can={can} lightDay={lightDay} onClose={() => setPhoto({ state: 'none' })}
          onMeds={() => undefined} onWhich={() => undefined} onLightDay={() => undefined}
          onFood={() => { setPhoto({ state: 'none' }); onFood({ rows: photo.rows, via: 'photo' }); }} />;
      })()}
      <form className="flex items-center gap-2 rounded-full border border-line bg-surface p-1.5 pl-4 shadow-sm" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="min-w-0 flex-1"><span className="sr-only">{L.field}</span>
          <input type="text" value={text} onChange={(e) => { listened.current = false; setText(e.target.value); }} placeholder={L.field} autoComplete="off" enterKeyHint="send"
            className="block min-h-tap w-full bg-transparent outline-none" /></label>
        {text.trim() && <button type="submit" aria-label={L.write} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent"><Send size={20} aria-hidden /></button>}
        {can('food.log') && <button type="button" onClick={pick} disabled={photo.state === 'busy'} aria-label={t.tiles.camera}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent disabled:opacity-40"><Camera size={20} aria-hidden /></button>}
        {speechSupported() && <button type="button" onClick={() => (busy ? stop.current() : listenNow())} aria-label={busy ? t.tiles.listening : t.tiles.mic}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-on-accent ${busy ? 'animate-pulse bg-warn' : 'bg-accent'}`}>
          {busy ? <Square size={18} aria-hidden /> : <Mic size={20} aria-hidden />}</button>}
        {fileInput}
      </form>
      {ask && <div className="protocol-card space-y-2 p-3 text-sm">
        <p>{t.voice.consent}</p>
        <button type="button" onClick={() => { giveVoiceOk(); listenNow(); }} className="min-h-tap rounded-full bg-accent px-4 font-semibold text-on-accent">{t.voice.consentOk}</button>
      </div>}
      {error && <p role="alert" className="px-3 text-sm text-muted">{t.voice.errors[error] ?? t.voice.errors.other}</p>}
    </section>
  );
}

/** D166: the assistant's answer, here. A question waits for its answer; the consent is asked once; the suggestions passed the
 *  plan and go to the evening only by a tap. The whole talk is on «Помічник». */
function AnswerCard({ talk, foods, onClose, onConsent, onEvening }: {
  talk: { q: string; a?: Answer }; foods: Map<string, Food>; onClose: () => void; onConsent: () => void; onEvening: (it: MealItem) => void;
}) {
  const A = t.assistant, a = talk.a;
  if (a && 'card' in a) return a.card === 'crisis' ? <CrisisCard className="" /> : <DangerCard className="" />;
  return (
    <div role="group" aria-label={L.answer} className="protocol-card relative max-h-[50dvh] space-y-2 overflow-y-auto p-3 pr-11" aria-live="polite">
      <button type="button" onClick={onClose} aria-label={L.close} className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center text-muted"><X size={18} aria-hidden /></button>
      <p className="text-sm text-muted">«{talk.q}»</p>
      {!a && <p role="status" className="text-sm text-muted">{A.thinking}</p>}
      {a && 'consent' in a && <><p className="text-sm">{A.consent}</p>
        <button type="button" onClick={onConsent} className="min-h-tap rounded-full bg-accent px-4 font-semibold text-on-accent">{A.allow}</button></>}
      {a && 'text' in a && <>
        {a.text && <p className={a.error ? 'text-warn' : ''}>{a.text}</p>}
        {a.notOffered?.map((x) => <p key={x.name} className="text-xs text-muted">{A.notOffered(x.name, x.reason, x.instead)}</p>) /* D132 */}
        {a.items && a.items.length > 0 && <ul className="space-y-2">
          {a.items.map((it) => { const b = brings(it, foods); return (
            <li key={it.name} data-suggestion={it.name} className="rounded-xl bg-bg p-2">
              <p className="font-medium">{it.name} <span className="font-normal text-muted">· {amountText(it)} {A.portionGuess}</span></p>
              <p className="text-xs text-muted">{A.brings(b.kcal, b.protein)}</p>
              <button type="button" onClick={() => onEvening(it)} className="mt-1 min-h-[2.25rem] rounded-full border border-accent px-3 text-xs text-accent">{A.toEvening}</button>
            </li>); })}
        </ul>}
      </>}
      <Link to="/assistant" className="inline-flex min-h-tap items-center text-sm text-accent underline">{L.wholeTalk}</Link>
    </div>
  );
}

function Card({ card, meal, can, lightDay, onClose, onMeds, onWhich, onLightDay, onFood }: {
  card: Reading; meal: string; can: (f: FeatureId) => boolean; lightDay: boolean; onClose: () => void; onMeds: (m: DueMed[]) => void; onWhich: (m: DueMed) => void;
  onLightDay: () => void; onFood: (d: VoiceDraft) => void;
}) {
  const shell = (children: React.ReactNode, label: string) => (
    <div role="group" aria-label={label} className="protocol-card relative space-y-2 p-3 pr-11">
      <button type="button" onClick={onClose} aria-label={L.close} className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center text-muted"><X size={18} aria-hidden /></button>
      {children}
    </div>
  );
  const button = 'min-h-tap rounded-full px-4 font-semibold';
  switch (card.kind) {
    case 'crisis': return <CrisisCard className="" />; // D130: the card and nothing else
    case 'danger': return <DangerCard className="" />;
    case 'meds': {
      if (!can('meds.log')) return shell(<p>{L.off(t.modules.names.meds)}</p>, L.off(t.modules.names.meds));
      const what = card.meds.map((m) => `${m.title}${m.time ? ` ${m.time}` : ''}`).join(', ');
      return shell(<><p className="font-semibold">{L.meds(what)}</p>
        <div className="flex gap-2"><button type="button" onClick={() => onMeds(card.meds)} className={`${button} bg-ok text-on-accent`}>{L.yes}</button>
          <button type="button" onClick={onClose} className={`${button} border-2 border-line`}>{L.no}</button></div></>, L.meds(what));
    }
    case 'which-med': return shell(<><p className="font-semibold">{L.which}</p>
      <div className="flex flex-wrap gap-2">{card.options.map((m) => <button key={m.key} type="button" onClick={() => onWhich(m)} className={`${button} border-2 border-line`}>{m.title}</button>)}</div></>, L.which);
    case 'med-done': return shell(<p>{L.medDone(card.titles.join(', '))}</p>, L.medDone(card.titles.join(', ')));
    case 'med-unknown': return shell(<p>{L.medUnknown}</p>, L.medUnknown);
    case 'water': return shell(<p>{L.off(t.modules.names.water)}</p>, L.off(t.modules.names.water)); // only when water is off
    case 'light-day': return lightDay
      ? shell(<><p className="font-semibold">{L.lightDay}</p><button type="button" onClick={onLightDay} className={`${button} bg-accent text-on-accent`}>{L.lightDayYes}</button></>, L.lightDay)
      : null;
    case 'assistant-off': return shell(<><p>{L.assistantOff}</p><Link to="/modules" className="inline-flex min-h-tap items-center text-accent underline">{L.modules}</Link></>, L.assistantOff);
    case 'no-card': return shell(<p>{L.noCard}</p>, L.noCard);
    case 'food': case 'edit': {
      if (!can('food.log')) return shell(<p>{L.off(t.modules.names.food)}</p>, L.off(t.modules.names.food));
      const d = card.draft;
      return shell(<>
        <p className="font-semibold">{L.food(meal)}</p>
        <ul className="space-y-1">
          {d.items.map((x, i) => <li key={i}>{x.item.name} <span className="tabular text-sm text-muted">· {amountText(x.item)}</span></li>)}
          {d.waterMl > 0 && <li>{t.voice.water(d.waterMl)}</li>}
          {d.notFound.map((x) => <li key={x} className="text-sm text-muted">«{x}» — {t.meal.notFound}</li>)}
        </ul>
        {(d.items.length > 0 || d.waterMl > 0) && <button type="button" onClick={() => onFood(d)} className={`${button} bg-ok text-on-accent`}>{L.write}</button>}
      </>, L.food(meal));
    }
    default: return null;
  }
}
