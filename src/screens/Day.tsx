import { differenceInMinutes, format } from 'date-fns';
import { EntryPreview } from '../components/EntryPreview';
import { pinMeal } from '../components/Favorites';
import { markMeds, TimeChoice } from '../components/MarkTime';
import { ConfirmMeal } from '../components/ConfirmMeal';
import { SymptomSheet } from '../components/SymptomSheet';
import { saved } from '../components/Toast';
import { Check, Droplet, Dumbbell, Frown, HeartPulse, ListChecks, Mic, NotebookPen, Pencil, Pill, Plus, Sparkles, Star, Target, Trash2, Undo2, UtensilsCrossed, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sheet, SheetButton } from '../components/Sheet';
import { db } from '../data/db';
import { useAllEntries, useDayEntries, useFoods, usePlan, useRecipes, useWorkouts } from '../data/queries';
import { buildChecklist, type CheckItem } from '../domain/checklist';
import { NOW_AFTER_MIN } from '../domain/reminders';
import { FOOD_COMPLETE, foodState, habits, mealsOf, frequentItems } from '../domain/habits';
import { addDays, parseISO as parseDay } from 'date-fns';
import { amountText } from '../domain/foodSearch';
import { exportDue } from '../data/backup';
import { useLiveQuery } from 'dexie-react-hooks';
import { atLocal, dateOf, newId, timeOf, todayISO } from '../domain/dates';
import { activeMode, dayTotals, effectiveTargets } from '../domain/nutrition';
import type { DayEntry, EntryKind } from '../domain/types';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';
import { useSync } from '../sync/runner';
import { SimpleEntrySheet } from './SimpleEntrySheet';
import { NowCard } from '../components/NowCard';
import { QuickDock, useOnScreen } from '../components/QuickDock';
import { DayHeader } from '../components/DayHeader';
import { DayRhythm } from '../components/DayRhythm';
import { ExampleNotice } from '../components/ExampleNotice';
import { hasExample } from '../data/seed.example';
import { DaySummary, type MetricKey } from '../components/DaySummary';
import { Loading } from '../components/Recovery';
import { useObservation } from '../app/observation';
import { observedTargets, scoredDay } from '../domain/observation';
import { TopupCard } from '../components/TopupCard';
import { PrnCard } from '../components/PrnCard';
import { PilotOffer, PilotSurvey } from '../components/PilotConsent';
import { VoiceSheet } from '../components/VoiceSheet';
import { nearLimit, topups, type DayState } from '../domain/topup';
import { dayRhythm } from '../domain/rhythm';
import { runningLow } from '../domain/stock';
import { unfinished } from '../domain/conclusion';
import { useFeatures } from '../app/features';
import { ENTRY_FEATURES, habitVisible, entryVisible, visibleChecklist } from '../domain/visibility';
import type { FeatureId } from '../domain/features';

import { lightDayOnDate } from '../domain/lightDay';
import { LightDayControl } from '../components/LightDayControl';
import { LightDayNotice } from '../components/LightDayNotice';
import { requestSync } from '../sync/runner';

const KIND_ICON = { meal: UtensilsCrossed, med: Pill, water: Droplet, workout: Dumbbell, note: NotebookPen, symptom: Frown } as const;

/** «День» (SPEC.md §5.1, §14.1, D53): the day by name and week, «Зараз», «Записати їжу», quick tiles, «Ритм дня» —
 *  the plan and the records on one time line — and «Уже сьогодні»; medicine and water float under the thumb. */
export function Day() {
  const { can, context, enabled } = useFeatures();
  const { date, setDate } = useUi();
  const { observation, ready: observationReady } = useObservation();
  const today = todayISO();
  const previousToday = useRef(today);
  useEffect(() => {
    if (enabled && previousToday.current !== today) {
      if (date === previousToday.current) setDate(today);
      requestSync();
    }
    previousToday.current = today;
  }, [today, date, enabled, setDate]);
  const light = enabled && !context.demo && date <= today && lightDayOnDate(observation?.events ?? [], date, observation?.now ?? new Date());
  // D34: a reminder opens its day (#/?date=…)
  const [params, setParams] = useSearchParams();
  const [voice, setVoice] = useState(false); // D95
  const recipes = useRecipes();
  const linked = params.get('date');
  useEffect(() => {
    if (linked && /^\d{4}-\d{2}-\d{2}$/.test(linked)) { setDate(linked); setParams({}, { replace: true }); }
  }, [linked, setDate, setParams]);
  const opening = params.get('open'); // D66: `#/do/symptom` lands here
  useEffect(() => {
    if (opening === 'symptom') { setSymptom({}); setParams({}, { replace: true }); }
    if (opening === 'voice') { setVoice(true); setParams({}, { replace: true }); } // D95: `#/do/voice` — Back Tap straight to the voice
  }, [opening, setParams]);
  const entries = useDayEntries(date);
  const foods = useFoods();
  const plan = usePlan();
  // D31: a recent sync is an encrypted copy too — no weekly «save a copy» nagging then
  const syncMeta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []); // D40: «код записаний?»
  const codeDue = !!syncMeta && Date.now() - (syncMeta.codeCheckedAt ?? 0) > 30 * 86_400_000;
  const syncLast = useSync((s) => (s.status === 'off' ? undefined : s.lastAt));
  const tips = !light && can('menu.evening') && can('food.log') ? [...new Set((entries ?? []).flatMap((e) => e.menu?.tips ?? []))] : []; // D33
  const syncedRecently = syncLast !== undefined && Date.now() - syncLast < 7 * 86_400_000;
  const workouts = useWorkouts();
  const firstEntry = useLiveQuery(() => db.entries.orderBy('at').first(), []);
  const navigate = useNavigate();
  const [rowFor, setRowFor] = useState<DayEntry | null>(null);
  const [confirming, setConfirming] = useState<DayEntry | null>(null); // D55
  const [adding, setAdding] = useState(false);
  const [yesterday, setYesterday] = useState(false);
  const [tilesRef, tilesOnScreen] = useOnScreen<HTMLElement>(); // D82
  const all = useAllEntries();
  const best = foods && all && workouts
    ? habits({ plan, entries: all, workouts, foods, today: todayISO(), observation }).filter((h) => h.streak >= 3 && habitVisible(h.key, context)).sort((a, b) => b.streak - a.streak)[0]
    : undefined; // D38
  const [simple, setSimple] = useState<{ kind: Exclude<EntryKind, 'meal' | 'symptom'>; entry?: DayEntry } | null>(null);
  const [symptom, setSymptom] = useState<{ entry?: DayEntry } | null>(null); // D56

  const mode = activeMode(plan, date);
  const targets = observedTargets(effectiveTargets(plan, date), date, observation);
  const totals = entries && foods ? dayTotals(entries, foods) : undefined;
  const isToday = date === todayISO();
  // R06: «Усе з’їдене записано» — a mark of the day, made and taken back by the person
  const markComplete = async (on: boolean) => {
    const id = `food-complete-${date}`;
    if (on) await saved(db.entries.put({ id, at: atLocal(date, '23:59'), kind: 'note', status: 'done', title: t.summary.foodComplete, checkKey: FOOD_COMPLETE }), t.summary.foodComplete, () => db.entries.delete(id));
    else { const was = await db.entries.get(id); await saved(db.entries.delete(id), t.toast.deleted(t.summary.foodComplete), () => (was ? db.entries.put(was) : undefined)); }
  };
  const visibleEntries = entries?.filter((e) => entryVisible(e, context) && (!light || !['meal', 'water', 'workout'].includes(e.kind)));
  const checklist = entries && foods && workouts ? visibleChecklist(buildChecklist({ plan, date, entries, workouts, foods, now: new Date(), observation }), context) : undefined;

  const setStatus = async (e: DayEntry, status: DayEntry['status']) => {
    setRowFor(null);
    const say = status === 'done' ? t.toast.done : status === 'skipped' ? t.toast.skipped : t.toast.backToPlan;
    await saved(db.entries.put({ ...e, status }), say(e.title), () => db.entries.put(e));
  };
  const waterRow = (): DayEntry => ({ id: newId(), at: atLocal(date, isToday ? format(new Date(), 'HH:mm') : '12:00'), kind: 'water', status: 'done',
    title: t.addKinds.water, waterMl: 250 });
  const meds = checklist?.items.filter((i) => i.kind === 'med') ?? [];
  const nextMed = meds.find((i) => !i.done && !i.skipped);
  // D50: a dose past its window is «не відмічено» (orange); D52: then — and on any other day — the dock asks when it was taken
  const medMissed = !!nextMed?.time && (date < todayISO() || (isToday && differenceInMinutes(new Date(), new Date(`${date}T${nextMed.time}:00`)) > NOW_AFTER_MIN));
  const [askMed, setAskMed] = useState<CheckItem | null>(null);
  /** The dock's two taps (D48): written at once, the dock itself says so and takes the undo. */
  const dockWater = async () => { if (!can('water.log')) return undefined; const e = waterRow(); await db.entries.add(e); return () => db.entries.delete(e.id); };
  const dockMed = async () => {
    if (!can('meds.log') || !nextMed) return undefined;
    if (!isToday || medMissed) { setAskMed(nextMed); return undefined; }
    const e: DayEntry = { id: newId(), at: atLocal(date, format(new Date(), 'HH:mm')),
      kind: 'med', status: 'done', title: nextMed.title, checkKey: nextMed.key, ...(nextMed.prescriptionId ? { prescriptionId: nextMed.prescriptionId } : {}) };
    await db.entries.add(e);
    return () => db.entries.delete(e.id);
  };
  const prevDay = format(addDays(parseDay(date), -1), 'yyyy-MM-dd');
  const copyMeal = async (e: DayEntry) => {
    const time = timeOf(e.at);
    const future = date > todayISO() || (isToday && time > format(new Date(), 'HH:mm'));
    const id = newId();
    await saved(db.entries.add({ ...e, id, at: atLocal(date, time), status: future ? 'planned' : 'done' }), t.toast.copied(e.title), () => db.entries.delete(id));
  };

  const edit = (e: DayEntry) => {
    setRowFor(null);
    if (e.kind === 'meal') navigate(`/meal/${e.id}`);
    else if (e.kind === 'symptom') setSymptom({ entry: e });
    else setSimple({ kind: e.kind, entry: e });
  };
  const startAdd = (kind: EntryKind) => {
    setAdding(false);
    if (!can(ENTRY_FEATURES[kind]) || (light && kind === 'workout')) return;
    if (kind === 'meal') navigate('/meal/new');
    else if (kind === 'symptom') setSymptom({});
    else setSimple({ kind });
  };

  const rhythm = visibleEntries ? dayRhythm({ entries: visibleEntries, date, observation, ...(checklist ? { checklist } : {}), ...(can('food.log') && targets.lastMealBy ? { lastMealBy: targets.lastMealBy } : {}) }) : undefined;
  const quickCandidates: { feature: FeatureId; label: string; Icon: typeof Sparkles; go: () => void; done?: boolean; badge?: string }[] = [
    { feature: 'menu.ai', label: t.menu.quick, Icon: Sparkles, go: () => navigate(`/menu?date=${date}`) },
    { feature: 'wellbeing.log', label: t.well.short, Icon: HeartPulse, go: () => navigate('/wellbeing') },
    { feature: 'workout.log', label: t.workout.title, Icon: Dumbbell, go: () => navigate('/workout'), done: !!workouts?.some((w) => w.date === date) },
    { feature: 'day.checklist', label: t.myday.title, Icon: ListChecks, go: () => navigate('/my-day'), badge: checklist && checklist.total > 0 ? t.myday.counter(checklist.done, checklist.total) : undefined },
    ...(enabled ? [{ feature: 'wellbeing.weight' as const, label: t.progress.weight, Icon: Target, go: () => navigate('/weight') }] : []),
  ];
  const quick = light ? [] : quickCandidates.filter((q) => can(q.feature));

  const allowedMetrics: MetricKey[] | undefined = observation ? [
    ...(can('meds.log') && meds.length ? ['meds' as const] : []), ...(can('water.log') && scoredDay(observation, 'water', date) ? ['water' as const] : []),
    ...(can('food.log') && scoredDay(observation, 'food', date) ? ['carbs', 'protein', 'calcium', 'kcal'] as const : []),
  ] : undefined;
  if (!observationReady) return <Loading />;
  return (
    <section className="pt-4">{/* the same top space as every other screen — the hero is not cut by the window edge */}
      <DayHeader date={date} setDate={setDate} action={enabled ? <LightDayControl date={date} /> : undefined} />
      {light && !isToday && <p className="mb-3 text-sm">{t.lightDay.enable}</p>}
      {enabled && isToday && <LightDayNotice date={date} />}

      {/* D53: recording food is one strong button on «День», not a row under a table */}
      <div className="mb-4 flex gap-2">
        {/* D97: the main action keeps its width — the voice sits inside its right edge, not beside it */}
        {can('food.log') && !light ? <div className="relative flex min-w-0 flex-1">
          <button type="button" onClick={() => navigate('/meal/new')}
            className="flex min-h-[3.5rem] min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-accent/40 bg-surface pl-2 pr-11 text-base font-semibold text-accent shadow-sm">
            <UtensilsCrossed size={20} className="shrink-0" aria-hidden />{t.day.recordFood}</button>
          {/* D95: say it — a meal, a medicine, water — in one window */}
          <button type="button" onClick={() => setVoice(true)} aria-label={t.voice.open} disabled={voice} /* D107: one window, one listener */
            className="absolute inset-y-1 right-1 flex w-10 items-center justify-center rounded-xl border-l border-accent/20 text-accent"><Mic size={20} aria-hidden /></button>
        </div> : <button type="button" onClick={() => setVoice(true)} disabled={voice} className="flex min-h-[3.5rem] flex-1 items-center justify-center gap-2 rounded-2xl border border-accent bg-surface px-3 font-medium text-accent"><Mic size={20} aria-hidden />{t.voice.open}</button>}
        {/* D56: a symptom with its time, next to the food it may follow */}
        <button type="button" onClick={() => setSymptom({})} aria-label={t.addKinds.symptom}
          className="flex min-h-[3.5rem] shrink-0 items-center justify-center gap-1.5 protocol-card rounded-2xl border border-line bg-surface px-2.5 text-[15px] font-medium shadow-sm">
          <Frown size={20} className="text-warn" aria-hidden />
          {/* D97: narrow phones keep «Записати їжу» whole — the words here get shorter, the name for a screen reader stays */}
          <span className="hidden min-[385px]:inline" aria-hidden>{t.addKinds.symptom}</span><span className="hidden min-[340px]:inline min-[385px]:hidden" aria-hidden>{t.day.unwellShort}</span></button>
      </div>

      {light && (can('food.log') || can('water.log')) && <details className="mb-4 rounded-2xl border border-line bg-surface p-3">
        <summary className="min-h-tap cursor-pointer font-medium">{t.lightDay.voluntary}</summary>
        <div className="flex flex-wrap gap-2">
          {can('food.log') && <button type="button" onClick={() => navigate('/meal/new')} className="min-h-tap px-3 text-accent underline">{t.day.recordFood}</button>}
          {can('water.log') && <button type="button" onClick={() => setSimple({ kind: 'water' })} className="min-h-tap px-3 text-accent underline">{t.addKinds.water}</button>}
        </div>
        {(entries ?? []).filter((e) => entryVisible(e, context) && e.status !== 'planned' && ['meal', 'water', 'workout'].includes(e.kind)).map((e) =>
          <button type="button" key={e.id} onClick={() => setRowFor(e)} className="block min-h-tap text-left text-sm">{timeOf(e.at)} · {e.title}</button>)}
      </details>}

      {quick.length > 0 && <nav ref={tilesRef} aria-label={t.day.quick} className={`mb-5 grid gap-1 ${quick.length === 4 ? 'grid-cols-[0.8fr_1.2fr_1.2fr_0.8fr] min-[380px]:grid-cols-4' : ''}`}
        style={quick.length === 4 ? undefined : { gridTemplateColumns: `repeat(${quick.length}, minmax(0, 1fr))` }}>
        {quick.map(({ label, Icon, go, badge, done }) => (
          <button key={label} type="button" onClick={go} aria-label={[label, done ? t.myday.workoutDone : badge].filter(Boolean).join(', ')} className="flex min-h-tap flex-col items-center gap-1 text-center">
            <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-surface shadow-sm"><Icon size={22} className="text-accent" aria-hidden />
              {badge && <span className="tabular absolute -right-2 -top-1.5 rounded-full bg-accent px-1.5 text-xs font-medium text-surface">{badge}</span>}
              {done && <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-bg bg-accent text-surface" aria-hidden><Check size={11} strokeWidth={3} /></span>}</span>
            <span className="max-w-full break-words text-[11px] leading-tight min-[380px]:text-xs">{label}</span>
          </button>
        ))}
      </nav>}
      {checklist && <QuickDock meds={{ done: meds.filter((i) => i.done).length, total: meds.length }} water={checklist.water}
          med={nextMed && { title: nextMed.title, ...(nextMed.time ? { time: nextMed.time } : {}), missed: medMissed }}
          onMed={dockMed} onWater={dockWater} hidden={tilesOnScreen} hideWater={light || !can('water.log')} />}

      <ExampleNotice plan={plan} />
      {entries && <NowCard entries={entries} plan={plan} date={date} observation={observation} onConfirm={setConfirming} />}
      {/* D40: one notice at a time — the code first, then the backup */}
      {isToday && codeDue && (
        <div role="status" className="mb-3 space-y-2 protocol-card rounded-2xl border border-line bg-surface p-3 text-sm">
          <p>{t.sync.codeCheck}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void saved(db.meta.update('sync', { codeCheckedAt: Date.now() }), t.sync.codeKept)}
              className="min-h-tap rounded-xl border border-line px-3">{t.sync.codeCheckYes}</button>
            <button type="button" onClick={() => navigate('/sync')} className="min-h-tap rounded-xl border border-accent px-3 font-medium text-accent">{t.sync.codeCheckShow}</button>
          </div>
        </div>
      )}
      {/* D81: no backup nag over the example — there is nothing of the person's to save yet */}
      {!codeDue && !syncedRecently && !(plan && hasExample(plan)) && exportDue(plan?.lastExportAt, firstEntry?.at.slice(0, 10), todayISO()) && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-2xl border border-warn/30 bg-warn-bg p-3 text-sm text-warn">
          <span className="flex-1">{plan?.lastExportAt ? t.backup.remind : t.backup.remindFirst}</span>
          <button type="button" onClick={() => navigate('/more')} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{t.backup.remindAction}</button>
        </div>
      )}

      {isToday && !codeDue && plan && !hasExample(plan) && <><PilotOffer /><PilotSurvey /></> /* D120, D121 */}

      {can('meds.log') && isToday && plan && all && runningLow(plan.prescriptions, all).map(({ p, days }) => ( /* D69: buy in time */
        <div key={p.id} role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-warn/30 bg-warn-bg p-3 text-sm text-warn">
          <span className="flex-1">{t.stock.low(p.title, days)}</span>
          <button type="button" onClick={() => navigate('/plan')} className="min-h-tap rounded-xl border border-warn px-3 font-medium">{t.stock.update}</button>
        </div>
      ))}

      {isToday && plan && !hasExample(plan) && unfinished(plan.prescriptions, todayISO()).map((p) => ( /* D100: kept by an older version without a dose or time */
        <div key={`u-${p.id}`} role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-warn/30 bg-warn-bg p-3 text-sm text-warn">
          <span className="flex-1">{t.plan.finish(p.title, !p.dose?.trim(), !p.schedule?.times.length)}</span>
          <button type="button" onClick={() => navigate('/plan')} className="min-h-tap rounded-xl border border-warn px-3 font-medium">{t.plan.finishAction}</button>
        </div>
      ))}


      {!light && can('progress.week') && plan?.weekGoal && ( /* D72: the week's goal, the person's own */
        <button type="button" onClick={() => navigate('/week')} className="mb-4 flex min-h-tap w-full items-center gap-2 protocol-card rounded-2xl border border-line bg-surface px-3 text-left text-sm">
          <Target size={18} className="shrink-0 text-accent" aria-hidden /><span className="text-muted">{t.week.dayLine}:</span><span className="font-medium">{plan.weekGoal.text}</span>
        </button>
      )}

      {!light && can('food.log') && mode && (
        <div className="mb-4 rounded-2xl border border-accent/30 bg-accent/10 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{mode.mode.title}</span>
            <span className="text-sm text-muted">{t.day.modeDay(mode.day, mode.of)}</span>
          </div>
          {mode.mode.notes.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm">{mode.mode.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          )}
        </div>
      )}

      {can('meds.prn') && isToday && plan && entries && <PrnCard plan={plan} date={date} entries={entries} /> /* D118 */}
      {rhythm && <DayRhythm date={date} title={isToday ? t.day.upcoming : t.day.rhythm} rhythm={rhythm} foods={foods} {...(can('menu.yesterday') && can('food.log') ? { onYesterday: () => setYesterday(true) } : {})} addLabel={enabled ? t.modules.addOther : undefined} onEntry={(e) => (e.kind === 'meal' && e.status === 'planned' && e.items?.length ? setConfirming(e) : setRowFor(e))} onDose={setAskMed} onAdd={() => setAdding(true)}
        onAnytime={(i) => (i.kind === 'workout' ? navigate('/workout') : setAskMed(i))} />}
      {totals && <DaySummary quiet={light} title={isToday ? t.summary.title : t.summary.forDay} totals={totals} targets={targets} allowed={allowedMetrics} meds={{ done: meds.filter((i) => i.done).length, total: meds.length }}
        {...(!light && isToday && best ? { streak: t.day.streak(t.progress.habit[best.key], best.streak) } : {})}
        {...(!light && entries ? { food: foodState(entries), onComplete: (on: boolean) => void markComplete(on) } : {})} />}

      {tips.length > 0 && (
        <details className="mb-4 protocol-card rounded-2xl border border-line bg-surface p-3">
          <summary className="min-h-tap cursor-pointer py-1 font-medium">{t.menu.tips}</summary>
          <ul className="list-disc space-y-1 pl-5 text-sm">{tips.map((x) => <li key={x}>{x}</li>)}</ul>
        </details>
      )}

      {!light && can('food.log') && isToday && plan && totals && foods && all && entries && (() => { // D92: top-up and «close to the limit», code only
        const s: DayState = { plan, targets, date, now: format(new Date(), 'HH:mm'), foods, entries: all, // R03: tips checked against the real day
          mealsDone: entries.filter((e) => e.kind === 'meal' && e.status === 'done').length,
          usual: frequentItems(all, date, 60, 50).map((f) => f.item.foodId ?? '').filter(Boolean),
          have: { kcal: totals.kcal, protein: totals.protein, calciumMg: totals.calciumMg, carbs: totals.carbs } };
        return <TopupCard date={date} targets={targets} tops={can('menu.topup') ? topups(s) : []} near={nearLimit(s)} />;
      })()}

      {voice && foods && all && (() => { const c = buildChecklist({ plan, date, entries: entries ?? [], workouts: workouts ?? [], foods, now: new Date(), observation }); return (
        <VoiceSheet date={date} plan={plan} foods={foods} recipes={recipes ?? []} today={entries ?? []}
          yesterday={all.filter((e) => dateOf(e.at) === prevDay)} onClose={() => setVoice(false)}
          meds={c.items.filter((i) => i.kind === 'med').map((i) => ({ key: i.key, title: i.title, ...(i.prescriptionId ? { prescriptionId: i.prescriptionId } : {}) }))} />); })()}
      {rowFor && entryVisible(rowFor, context) && (
        <Sheet title={rowFor.title} onClose={() => setRowFor(null)}>
          <EntryPreview entry={rowFor} foods={foods} {...(all ? { all } : {})} />
          {rowFor.kind !== 'symptom' && rowFor.status !== 'done' && <SheetButton tone="accent" onClick={() => setStatus(rowFor, 'done')}><Check size={20} />{t.rowActions.done}</SheetButton>}
          {rowFor.kind !== 'symptom' && rowFor.status !== 'skipped' && <SheetButton onClick={() => setStatus(rowFor, 'skipped')}><X size={20} />{t.rowActions.skipped}</SheetButton>}
          {rowFor.kind !== 'symptom' && rowFor.status !== 'planned' && <SheetButton onClick={() => setStatus(rowFor, 'planned')}><Undo2 size={20} />{t.rowActions.planned}</SheetButton>}
          <SheetButton onClick={() => edit(rowFor)}><Pencil size={20} />{t.rowActions.edit}</SheetButton>
          {rowFor.kind === 'meal' && !!rowFor.items?.length && (
            <SheetButton onClick={() => { const e = rowFor; setRowFor(null); void pinMeal(e.title, e.items!); }}><Star size={20} />{t.meal.pin}</SheetButton>
          )}
          <SheetButton tone="danger" onClick={async () => { const e = rowFor; setRowFor(null); await saved(db.entries.delete(e.id), t.toast.deleted(e.title), () => db.entries.put(e)); }}>
            <Trash2 size={20} />{t.rowActions.delete}</SheetButton>
        </Sheet>
      )}
      {confirming && can('food.log') && <ConfirmMeal entry={confirming} date={date} foods={foods} onClose={() => setConfirming(null)}
        onEdit={() => { const e = confirming; setConfirming(null); edit(e); }}
        onPin={() => { const e = confirming; setConfirming(null); void pinMeal(e.title, e.items!); }}
        onDelete={() => { const e = confirming; setConfirming(null); void saved(db.entries.delete(e.id), t.toast.deleted(e.title), () => db.entries.put(e)); }} />}
      {adding && (
        <Sheet title={t.day.addRow} onClose={() => setAdding(false)}>
          {(Object.keys(KIND_ICON) as EntryKind[]).filter((k) => can(ENTRY_FEATURES[k]) && (!light || k !== 'workout')).map((k) => {
            const Icon = KIND_ICON[k];
            return <SheetButton key={k} onClick={() => startAdd(k)}><Icon size={20} />{t.addKinds[k]}</SheetButton>;
          })}
        </Sheet>
      )}
      {yesterday && can('menu.yesterday') && can('food.log') && all && (() => {
        const meals = mealsOf(all, prevDay);
        return (
          <Sheet title={t.day.yesterdayTitle} onClose={() => setYesterday(false)}>
            {meals.length === 0 && <p className="mb-2 text-muted">{t.day.yesterdayEmpty}</p>}
            {meals.length === 0 && <SheetButton tone="accent" onClick={() => navigate('/meal/new')}><UtensilsCrossed size={20} />{t.day.firstMeal}</SheetButton>}
            {meals.map((e) => (
              <SheetButton key={e.id} onClick={() => void copyMeal(e).then(() => setYesterday(false))}>
                <UtensilsCrossed size={20} className="shrink-0" />
                <span className="min-w-0 flex-1"><span className="block font-medium">{timeOf(e.at)} · {e.title}</span>
                  <span className="block truncate text-sm text-muted">{e.items?.map((i) => `${i.name} ${amountText(i)}`).join(', ')}</span></span>
              </SheetButton>
            ))}
            {meals.length > 1 && (
              <SheetButton tone="accent" onClick={() => void Promise.all(meals.map(copyMeal)).then(() => setYesterday(false))}>
                <Plus size={20} />{t.day.addAll}</SheetButton>
            )}
          </Sheet>
        );
      })()}
      <p className="text-center"><button type="button" onClick={() => navigate('/frictions')} className="min-h-tap px-2 text-sm text-muted underline">{t.friction.ask}</button></p>
      {checklist && <div className="h-40 md:h-16" aria-hidden /> /* D48: the last record stays above the floating dock */}
      {askMed && can('meds.log') && <TimeChoice title={askMed.title} {...(askMed.time ? { planned: askMed.time } : {})} date={date} onClose={() => setAskMed(null)}
        onPick={(when) => void markMeds([{ key: askMed.key, title: askMed.title, ...(askMed.prescriptionId ? { prescriptionId: askMed.prescriptionId } : {}) }],
          date, askMed.time, 'done', when)} />}
      {symptom && all && <SymptomSheet date={date} {...(symptom.entry ? { entry: symptom.entry } : {})} all={all} {...(foods ? { foods } : {})} onClose={() => setSymptom(null)} />}
      {simple && can(ENTRY_FEATURES[simple.kind]) && <SimpleEntrySheet kind={simple.kind} entry={simple.entry} date={date} onClose={() => setSimple(null)} />}
    </section>
  );
}
