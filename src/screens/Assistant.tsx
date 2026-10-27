import { profileKey } from '../data/profiles';
// D117: «Помічник» — ask in words or by voice, the answer comes at once. «Що добрати до вечора?» is answered by the code
// (the day against the plan, three things that pass it); anything else goes to the model with the day's numbers and the
// plan's rules — its words come back without numbers, every food it names is turned into a line of the base, checked
// against the plan (what fails is not shown) and counted here. Medicines, symptoms, changing the plan — the app's own words;
// a danger sign — the 103 card, no model at all. Nothing is written for the person: a tap puts a suggestion in the evening's
// plan as a planned snack, to tick when eaten. Works without sync (the device token, D101).
import { format } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import { Mic, Send, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DangerCard } from '../components/DangerCard';
import { CrisisCard } from '../components/CrisisCard';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { db, inDemo } from '../data/db';
import { keep, kept } from '../data/kept';
import { useAllEntries, useDayEntries, useFoods, usePlan, useRecipes } from '../data/queries';
import { listen, speechSupported } from '../data/speech';
import { brings, dayContext, historyFor, lineOf, passing, routeQuestion, scrubTalk, shownReply, withoutDropped } from '../domain/assistant';
import { appVersion, planVersion } from '../domain/concierge';
import { atLocal, newId, todayISO } from '../domain/dates';
import { amountText } from '../domain/foodSearch';
import { frequentItems } from '../domain/habits';
import { dayTotals, effectiveTargets } from '../domain/nutrition';
import { dishItem } from '../domain/recipes';
import { topups } from '../domain/topup';
import type { DayEntry, MealItem } from '../domain/types';
import { t } from '../i18n/uk';
import { ApiError, assistantChat } from '../sync/api';
import { count } from '../data/tally';
import { passes } from '../domain/evaluate';
import { currentKeys } from '../sync/runner';
import { SceneHeader } from '../components/SceneHeader';

const L = t.assistant;
const CONSENT = profileKey('protocol.assistantConsent');
const consented = () => { try { return localStorage.getItem(CONSENT) === '1'; } catch { return false; } };
interface Msg { id: string; role: 'user' | 'assistant'; text: string; items?: MealItem[]; card?: 'danger' | 'crisis'; danger?: true; error?: true
  notOffered?: { name: string; reason: string; instead?: string }[] }

export function Assistant() {
  const date = todayISO();
  const plan = usePlan(), foods = useFoods(), recipes = useRecipes(), entries = useDayEntries(date), all = useAllEntries();
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const [params, setParams] = useSearchParams();
  // D132: a talk kept on the phone is cleaned on loading — what held danger or despair (kept before D130 too) is gone
  const [msgs, setMsgs] = useState<Msg[]>(() => scrubTalk(kept<Msg[]>(`assistant:${date}`) ?? []));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [askConsent, setAskConsent] = useState<string | null>(null);
  const stop = useRef<() => void>(() => undefined);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { keep(`assistant:${date}`, msgs); end.current?.scrollIntoView({ block: 'end' }); }, [msgs, date]);

  const targets = useMemo(() => (plan ? effectiveTargets(plan, date) : {}), [plan, date]);
  const totals = useMemo(() => (entries && foods ? dayTotals(entries, foods) : null), [entries, foods]);
  const usual = useMemo(() => (all ? frequentItems(all, date, 60, 50).map((f) => f.item.foodId ?? '').filter(Boolean) : []), [all, date]);

  const say = (m: Omit<Msg, 'id'>) => setMsgs((xs) => [...xs, { ...m, id: newId() }]);
  /** D130: a 103 or crisis card — the talk is cleared (its words are not kept here and never go with the next question) */
  const card = (kind: 'danger' | 'crisis') => setMsgs([{ id: newId(), role: 'assistant', text: '', card: kind }]);
  /** Scenario 3 asked in words — the code's numbers and three things that pass the plan; no model. */
  const topupAnswer = () => {
    if (!plan || !foods || !totals || !entries) return;
    const tops = topups({ plan, targets, date, now: format(new Date(), 'HH:mm'), foods, usual, ...(all ? { entries: all } : {}),
      mealsDone: entries.filter((e) => e.kind === 'meal' && e.status === 'done').length,
      have: { kcal: totals.kcal, protein: totals.protein, calciumMg: totals.calciumMg, carbs: totals.carbs } }, true);
    if (!tops.length) {
      const any = targets.kcal !== undefined || targets.proteinG !== undefined || targets.calciumMg !== undefined;
      say({ role: 'assistant', text: !any ? L.noTargets : !entries.some((e) => e.kind === 'meal' && e.status === 'done') ? L.nothingRecorded : L.allReached });
      return;
    }
    const lines = tops.map((x) => t.topup.ask(t.topup.goals[x.goal], x.have, x.target, t.topup.units[x.goal]).replace(' Добрати до вечора?', ''));
    const items = [...new Map(tops.flatMap((x) => x.items).map((it) => [it.name, it])).values()].slice(0, 3);
    say({ role: 'assistant', text: `${lines.join(' ')} ${L.canAdd}`, items });
  };
  useEffect(() => { // D116: the evening push opens the assistant on this question
    if (params.get('ask') === 'topup' && plan && foods && totals && entries) { setParams({}, { replace: true }); say({ role: 'user', text: L.chips[0]! }); topupAnswer(); }
  }, [params, plan, foods, totals, entries]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async (q: string, consent = consented() || !!meta?.conciergeConsent) => {
    const words = q.trim();
    if (!words || !plan || !foods || !recipes || !totals) return;
    setText('');
    const route = routeQuestion(words, plan); // D130: by this question alone, not by the talk before it
    if (route === 'crisis' || route === 'danger') { card(route); return; } // before any model; the talk is cleared
    if (!askConsent) say({ role: 'user', text: words });
    if (route === 'topup') { topupAnswer(); return; }
    if (inDemo()) { say({ role: 'assistant', text: L.demo }); return; } // D98
    if (!consent) { setAskConsent(words); return; }
    setAskConsent(null); setBusy(true);
    const names = [...[...foods.values()].map((f) => f.name), ...recipes.map((r) => r.name)];
    const history = historyFor(msgs.map((m) => ({ role: m.role, text: m.text, ...(m.card || m.danger ? { card: m.card ?? 'danger' } : {}) })));
    try {
      const r = await assistantChat(currentKeys() ?? null, { text: words, history, names, log: !!meta?.conciergeLog && !!currentKeys(),
        context: dayContext(plan, targets, totals, format(new Date(), 'HH:mm'), usual.map((id) => foods.get(id)?.name ?? '').filter(Boolean)),
        versions: { app: appVersion(), plan: planVersion(plan) } });
      const reply = shownReply(r, plan); // D130: the model said to call now — the 103 card, never a softer «запишіть у звіт»
      if ('card' in reply) { card('danger'); return; }
      if (reply.fixed) { say({ role: 'assistant', text: reply.text }); return; }
      const lines = r.items.flatMap((x) => { const it = lineOf(x.name, x.grams, [...foods.values()], recipes, dishItem); return it ? [it] : []; });
      const { shown, dropped, why } = passing(lines, plan, date, foods, all ?? []); // what fails the plan in the real day is not shown (R03)
      // R04: nor said — the words naming a food taken out go; all taken out — said plainly
      const said = withoutDropped(r.text, dropped, shown.map((x) => x.name));
      const text = lines.length && !shown.length ? `${said ? `${said} ` : ''}${L.allDropped(dropped.join(', '))}` : said || L.empty;
      say({ role: 'assistant', text, ...(shown.length ? { items: shown } : {}), ...(shown.length && why.length ? { notOffered: why } : {}) });
    } catch (e) {
      const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
      say({ role: 'assistant', text: (L.errors as Record<string, string>)[code] ?? L.errors.other ?? '', error: true });
    } finally { setBusy(false); }
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
    // R03: checked again now — the day may have changed since the answer
    if (plan && foods && !passes({ plan, date, foods, entries: all ?? [] }, it)) { say({ role: 'assistant', text: L.changed(it.name) }); return; }
    const by = targets.lastMealBy ?? '20:00', later = format(new Date(Date.now() + 900_000), 'HH:mm');
    const e: DayEntry = { id: newId(), at: atLocal(date, later < by ? later : by), kind: 'meal', status: 'planned', title: t.topup.snack, items: [it] };
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
    <section className="flex min-h-[calc(100dvh-9rem)] flex-col gap-3 pt-4">
      <SceneHeader title={L.title} description={L.hint}>
        {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} className="min-h-tap rounded-xl border border-white/25 px-3 text-sm text-white">{L.newTalk}</button> /* D130 */}
      </SceneHeader>
      <p className="protocol-card rounded-2xl border border-line bg-surface p-3 text-sm">{facts.length ? `${L.today} ${facts.join(' · ')}` : L.noTargetsShort}</p>
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
          <button type="button" onClick={() => { try { localStorage.setItem(CONSENT, '1'); } catch { /* private mode */ } void ask(askConsent, true); }}
            className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.allow}</button>
        </div>
      )}
      {msgs.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {L.chips.map((c, i) => (
            <button key={c} type="button" onClick={() => (i === 1 ? setText(c) : void ask(c))} className="min-h-[2.25rem] rounded-full border border-line px-3 text-sm">{c}</button>
          ))}
        </div>
      )}
      <form className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex gap-2 bg-bg py-2 md:bottom-0" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        {speechSupported() && (
          <button type="button" onClick={mic} aria-label={listening ? L.stop : L.speak}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${listening ? 'animate-pulse bg-warn' : 'bg-accent'} text-surface`}>
            {listening ? <Square size={20} aria-hidden /> : <Mic size={22} aria-hidden />}</button>
        )}
        <label className="flex-1"><span className="sr-only">{L.input}</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={L.placeholder} className="block min-h-12 w-full rounded-xl border border-line bg-surface px-3" /></label>
        <button type="submit" disabled={!text.trim() || busy} aria-label={L.send} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent text-accent disabled:opacity-40"><Send size={20} aria-hidden /></button>
      </form>
    </section>
  );
}
