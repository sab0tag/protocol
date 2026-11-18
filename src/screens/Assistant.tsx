// D117: «Помічник» — ask in words or by voice, the answer comes at once. «Що добрати до вечора?» is answered by the code
// (the day against the plan, three things that pass it); anything else goes to the model with the day's numbers and the
// plan's rules — its words come back without numbers, every food it names is turned into a line of the base, checked
// against the plan (what fails is not shown) and counted here. Medicines, symptoms, changing the plan — the app's own words;
// a danger sign — the 103 card, no model at all. Nothing is written for the person: a tap puts a suggestion in the evening's
// plan as a planned snack, to tick when eaten. Works without sync (the device token, D101).
import { useLiveQuery } from 'dexie-react-hooks';
import { Mic, Send, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DangerCard } from '../components/DangerCard';
import { CrisisCard } from '../components/CrisisCard';
import { Loading } from '../components/Recovery';
import { ExampleNotice } from '../components/ExampleNotice';
import { saved } from '../components/Toast';
import { db } from '../data/db';
import { useAllEntries, useDayEntries, useFoods, usePlan, useRecipes } from '../data/queries';
import { listen, speechSupported } from '../data/speech';
import { answer, assistantConsented, eveningSnack, giveAssistantConsent, keepTalk, talkOf, topupReply, type Msg, type Reply } from '../app/assistantAnswer';
import { brings, routeQuestion } from '../domain/assistant';
import { newId, todayISO } from '../domain/dates';
import { amountText } from '../domain/foodSearch';
import { dayTotals, effectiveTargets } from '../domain/nutrition';
import type { MealItem } from '../domain/types';
import { t } from '../i18n/uk';
import { count } from '../data/tally';
import { SceneHeader } from '../components/SceneHeader';

const L = t.assistant;

export function Assistant() {
  const date = todayISO();
  const plan = usePlan(), foods = useFoods(), recipes = useRecipes(), entries = useDayEntries(date), all = useAllEntries();
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  // D132: a talk kept on the phone is cleaned on loading — what held danger or despair (kept before D130 too) is gone
  const [msgs, setMsgs] = useState<Msg[]>(() => talkOf(date));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [askConsent, setAskConsent] = useState<string | null>(null);
  const stop = useRef<() => void>(() => undefined);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  /** D130: each cleared talk is a new one — an answer still on its way to a cleared talk must not land in the next. */
  const talk = useRef(0);
  const clearTalk = (next: Msg[] = []) => { talk.current += 1; setMsgs(next); setBusy(false); };
  /** D143: a filled question waits in the field, the caret at its end — sending stays the person's tap. */
  const fill = (q: string) => { setText(q); requestAnimationFrame(() => { field.current?.focus(); field.current?.setSelectionRange(q.length, q.length); }); };
  useEffect(() => { keepTalk(date, msgs); end.current?.scrollIntoView({ block: 'end' }); }, [msgs, date]);

  const targets = useMemo(() => (plan ? effectiveTargets(plan, date) : {}), [plan, date]);
  const totals = useMemo(() => (entries && foods ? dayTotals(entries, foods) : null), [entries, foods]);

  const say = (m: Omit<Msg, 'id'>) => setMsgs((xs) => [...xs, { ...m, id: newId() }]);
  /** D130: a 103 or crisis card — the talk is cleared (its words are not kept here and never go with the next question) */
  const card = (kind: 'danger' | 'crisis') => clearTalk([{ id: newId(), role: 'assistant', text: '', card: kind }]);
  const reply = (r: Reply) => say({ role: 'assistant', ...r });
  const day = plan && foods && recipes && all ? { plan, foods, recipes, all, date } : undefined;
  /** Scenario 3 asked in words — the code's numbers and three things that pass the plan; no model. */
  const topupAnswer = () => { if (day) reply(topupReply(day)); };
  useEffect(() => { // D162: a question from the one field (the D166 flag off) — put in the field, sent only by the person
    const q = params.get('q');
    if (q) { setParams({}, { replace: true }); fill(q); }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // D116: the evening push opens the assistant on this question
    if (params.get('ask') === 'topup' && plan && foods && totals && entries) { setParams({}, { replace: true }); say({ role: 'user', text: L.chips[0]! }); topupAnswer(); }
  }, [params, plan, foods, totals, entries]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async (q: string, consent = assistantConsented(!!meta?.conciergeConsent)) => {
    const words = q.trim();
    if (!words || !day || !totals) return;
    setText('');
    const route = routeQuestion(words, day.plan); // D130: danger and despair — the card at once; their words are never put in the talk
    if (route === 'crisis' || route === 'danger') { card(route); return; }
    if (!askConsent) say({ role: 'user', text: words });
    const asked = talk.current;
    setBusy(true);
    const a = await answer(words, day, { consent, log: !!meta?.conciergeLog, history: msgs });
    if (asked !== talk.current) return; // the talk was cleared while the model answered (D130)
    setBusy(false);
    if ('card' in a) { card(a.card); return; } // before any model, or the model said to call now; the talk is cleared
    if ('consent' in a) { setAskConsent(words); return; }
    setAskConsent(null);
    reply(a);
  };

  const mic = () => {
    if (listening) { stop.current(); return; }
    setListening(true);
    stop.current = listen({ interim: setText, final: (x) => { setText(''); void ask(x); }, error: () => setListening(false), end: () => setListening(false) });
  };
  const [added, setAdded] = useState<Set<string>>(new Set()); // R04: one tap, one planned snack — a second tap adds nothing
  const toEvening = async (it: MealItem, key: string) => { // a planned snack for the evening — never what was eaten (boundary 5)
    if (added.has(key)) return;
    setAdded((s) => new Set(s).add(key));
    if (!day) return;
    const e = eveningSnack(it, day); // R03: checked again now — the day may have changed since the answer
    if (!e) { say({ role: 'assistant', text: L.changed(it.name) }); return; }
    await saved(db.entries.add(e), t.topup.planned(it.name), () => db.entries.delete(e.id));
    void count('topup_taken'); // D119
  };

  if (!plan || !foods || !recipes || !entries || !totals) return <Loading />;
  const fmt = (n: number) => String(Math.round(n));
  const facts = [targets.kcal !== undefined ? L.fact(t.topup.goals.kcal, fmt(totals.kcal), targets.kcal, 'ккал') : '',
    targets.proteinG !== undefined ? L.fact(t.topup.goals.proteinG, fmt(totals.protein), targets.proteinG, 'г') : '',
    targets.calciumMg !== undefined ? L.fact(t.topup.goals.calciumMg, fmt(totals.calciumMg), targets.calciumMg, 'мг') : '',
    targets.carbsG?.max !== undefined ? L.carbs(fmt(totals.carbs), targets.carbsG.max) : ''].filter(Boolean);

  return (
    <section className="flex min-h-[calc(100dvh-5.5rem)] flex-col gap-3 pt-4">
      <SceneHeader title={L.title} description={L.hint}>
        {msgs.length > 0 && <button type="button" onClick={() => clearTalk()} className="min-h-tap rounded-xl border border-accent px-3 text-sm font-medium text-accent">{L.newTalk}</button> /* D130 */}
      </SceneHeader>
      <ExampleNotice plan={plan} />
      <p className="protocol-card rounded-2xl border border-line bg-surface p-3 text-sm">{facts.length ? `${L.today} ${facts.join(' · ')}` : L.noTargetsShort}</p>
      {msgs.length === 0 && (
        <div role="group" className="flex flex-wrap gap-2" aria-label="Швидкі запитання">
          {L.chips.map((c, i) => (
            <button key={c} type="button" onClick={() => (i === 1 ? fill(c) : void ask(c))} className="min-h-tap rounded-2xl border border-line px-3 py-1 text-left text-sm">
              {c.trim()}{i === 1 ? '…' : ''}<span className="block text-xs text-muted">{L.chipHints[i]}</span></button>
          ))}
        </div>
      )}
      <ul className={`${msgs.length ? 'flex-1 ' : ''}space-y-2`} aria-label={L.title} aria-live="polite">
        {msgs.map((m) => (
          <li key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
            {m.card === 'crisis' ? <CrisisCard className="" /> : m.card === 'danger' || m.danger ? <DangerCard className="" /> : (
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'bg-accent text-surface' : m.error ? 'border border-warn/40 text-warn' : 'border border-line bg-surface'}`}>
                {m.text && <p>{m.text}</p>}
                {m.notOffered?.map((x) => <p key={x.name} className="mt-1 text-xs text-muted">{L.notOffered(x.name, x.reason, x.instead)}</p>) /* D132 */}
                {m.items && m.items.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    {m.items.map((it) => { const b = brings(it, foods); return (
                      <li key={it.name} data-suggestion={it.name} className="rounded-xl bg-bg p-2">
                        <p className="font-medium">{it.name} <span className="font-normal text-muted">· {amountText(it)} {L.portionGuess}</span></p>
                        <p className="text-xs text-muted">{L.brings(b.kcal, b.protein)}</p>
                        <button type="button" disabled={added.has(`${m.id}:${it.name}`)} onClick={() => void toEvening(it, `${m.id}:${it.name}`)}
                          className="mt-1 min-h-[2.25rem] rounded-full border border-accent px-3 text-xs text-accent disabled:opacity-40">{added.has(`${m.id}:${it.name}`) ? L.added : L.toEvening}</button>
                      </li>); })}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
        {busy && <li className="text-sm text-muted" role="status">{L.thinking}</li>}
      </ul>
      <div ref={end} />
      {askConsent && (
        <div className="space-y-2 rounded-xl border border-accent/40 p-3 text-sm">
          <p>{L.consent}</p>
          <button type="button" onClick={() => { giveAssistantConsent(); void ask(askConsent, true); }}
            className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.allow}</button>
        </div>
      )}
      {msgs.length === 0 && (
        <section className="protocol-card space-y-3 p-4" aria-label="Швидкі сценарії помічника">
          <div>
            <h2 className="text-lg font-semibold">Чим можу допомогти?</h2>
            <p className="mt-1 text-sm text-muted">Оберіть підказку або запитайте своїми словами. Перед передаванням запиту до AI потрібна згода.</p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => navigate('/')} className="min-h-tap rounded-xl border border-line bg-bg p-3 text-left text-sm font-medium">Що мені зараз важливо? <span className="mt-1 block text-xs font-normal text-muted">Відкрити план дня →</span></button>
            <button type="button" onClick={() => fill('Що приготувати на вечерю з урахуванням мого плану?')} className="min-h-tap rounded-xl border border-line bg-bg p-3 text-left text-sm font-medium">Що приготувати на вечерю? <span className="mt-1 block text-xs font-normal text-muted">Підставити запит для перевірки →</span></button>
            <button type="button" onClick={() => navigate('/week')} className="min-h-tap rounded-xl border border-line bg-bg p-3 text-left text-sm font-medium">Як проходить мій тиждень? <span className="mt-1 block text-xs font-normal text-muted">Відкрити підсумок →</span></button>
            <button type="button" onClick={() => navigate('/report')} className="min-h-tap rounded-xl border border-line bg-bg p-3 text-left text-sm font-medium">Що підготувати до лікаря? <span className="mt-1 block text-xs font-normal text-muted">Відкрити звіт →</span></button>
          </div>

        </section>
      )}
      <form className="sticky bottom-[calc(var(--tabbar)+.25rem+env(safe-area-inset-bottom))] mt-auto flex gap-2 bg-bg py-2 md:bottom-0" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        {speechSupported() && (
          <button type="button" onClick={mic} aria-label={listening ? L.stop : L.speak}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${listening ? 'animate-pulse bg-warn' : 'bg-accent'} text-surface`}>
            {listening ? <Square size={20} aria-hidden /> : <Mic size={22} aria-hidden />}</button>
        )}
        <label className="flex-1"><span className="sr-only">{L.input}</span>
          <input ref={field} value={text} onChange={(e) => setText(e.target.value)} placeholder={L.placeholder} className="block min-h-12 w-full rounded-xl border border-line bg-surface px-3" /></label>
        <button type="submit" disabled={!text.trim() || busy} aria-label={L.send} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent text-accent disabled:opacity-40"><Send size={20} aria-hidden /></button>
      </form>
    </section>
  );
}
