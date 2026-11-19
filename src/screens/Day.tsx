import { format } from 'date-fns';
import { sessionsOn } from '../domain/rehab';
import { ActionDetail, applyEntryChange } from '../components/ActionDetail';
import { withStatus } from '../data/entryActions';
import { RescheduleMeal } from '../components/RescheduleMeal';
import { pinMeal } from '../components/Favorites';
import { markMeds, SkipChoice, TimeChoice } from '../components/MarkTime';
import { ConfirmMeal } from '../components/ConfirmMeal';
import { SymptomSheet } from '../components/SymptomSheet';
import { saved } from '../components/Toast';
import { Check, ChevronRight, Droplet, Dumbbell, Frown, NotebookPen, Pencil, Pill, Plus, Star, Target, Trash2, Undo2, UtensilsCrossed, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sheet, SheetButton } from '../components/Sheet';
import { db } from '../data/db';
import { useAllEntries, useDayEntries, useFoods, usePlan, useRecipes, useWorkouts } from '../data/queries';
import { buildChecklist, type CheckItem } from '../domain/checklist';
import { FOOD_COMPLETE, foodState, mealsOf, frequentItems } from '../domain/habits';
import { addDays, differenceInCalendarDays, parseISO as parseDay } from 'date-fns';
import { amountText } from '../domain/foodSearch';
import { exportDue } from '../data/backup';
import { useLiveQuery } from 'dexie-react-hooks';
import { atLocal, dateOf, newId, timeOf, todayISO } from '../domain/dates';
import { activeMode, dayTotals, effectiveTargets } from '../domain/nutrition';
import { dayFluid } from '../domain/fluid';
import type { DayEntry, EntryKind } from '../domain/types';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';
import { useSync } from '../sync/runner';
import { SimpleEntrySheet } from './SimpleEntrySheet';
import { NowCard } from '../components/NowCard';
import { InjectionSiteCard } from '../components/InjectionSiteCard';
import { SideEffectsCard } from '../components/SideEffectsCard';
import { DayHeader } from '../components/DayHeader';
import { DayRhythm } from '../components/DayRhythm';
import { ExampleNotice } from '../components/ExampleNotice';
import { hasExample } from '../data/seed.example';
import { Loading } from '../components/Recovery';
import { useObservation } from '../app/observation';
import { observedTargets, scoredDay } from '../domain/observation';
import { TopupCard } from '../components/TopupCard';
import { PrnCard } from '../components/PrnCard';
import { PilotOffer, PilotSurvey } from '../components/PilotConsent';
import { VoiceSheet } from '../components/VoiceSheet';
import { nearLimit, topups, type DayState } from '../domain/topup';
import { presentDay } from '../domain/dayPresentation';
import { runningLow } from '../domain/stock';
import { unfinished } from '../domain/conclusion';
import { useFeatures } from '../app/features';
import { MealTiles, type TileDraft } from '../components/MealTiles';
import { OneInput } from '../components/OneInput';
import { QuickMarks } from '../components/QuickMarks';
import { blockKeyFor, slotAt, type Slot } from '../domain/mealSlots';
import { ENTRY_FEATURES, entryVisible } from '../domain/visibility';

import { lightDayOnDate } from '../domain/lightDay';
import { LightDayControl } from '../components/LightDayControl';
import { LightDayNotice } from '../components/LightDayNotice';
import { requestSync } from '../sync/runner';

const KIND_ICON = { meal: UtensilsCrossed, med: Pill, water: Droplet, workout: Dumbbell, note: NotebookPen, symptom: Frown } as const;

/** Today projects the existing plan into attention, pending actions, quantitative goals and confirmed history.
 * All write handlers and feature boundaries stay in this screen. */
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
  const mealParam = params.get('meal'); // D159: `#/meal/new` opens the tile of the meal going on now
  const [openTile, setOpenTile] = useState<string | null>(null);
  const [tileDraft, setTileDraft] = useState<TileDraft | null>(null); // D162: food said in the one field
  const [listenTile, setListenTile] = useState(false); // D164: `#/do/food` — the tile open and the microphone on
  const [openMark, setOpenMark] = useState<'meds' | 'mood' | null>(null); // D164: `#/do/meds`, `#/do/mood`
  useEffect(() => {
    if (mealParam !== null && /^[0-3]$/.test(mealParam)) { setOpenTile(blockKeyFor(Number(mealParam) as Slot)); setListenTile(params.get('mic') === '1'); setParams({}, { replace: true }); }
  }, [mealParam, params, setParams]);
  useEffect(() => {
    if (opening === 'symptom') { setSymptom({}); setParams({}, { replace: true }); }
    if (opening === 'voice') { setVoice(true); setParams({}, { replace: true }); } // D95: `#/do/voice` — Back Tap straight to the voice
    if (opening === 'meds' || opening === 'mood') { setOpenMark(opening); setParams({}, { replace: true }); }
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
  const [skippingRow, setSkippingRow] = useState<DayEntry | null>(null);
  const [rescheduling, setRescheduling] = useState<DayEntry | null>(null);
  const [confirming, setConfirming] = useState<DayEntry | null>(null); // D55
  const [adding, setAdding] = useState(false);
  const [yesterday, setYesterday] = useState(false);
  const all = useAllEntries();
  const lastRecordedDate = useLiveQuery(async () => {
    const [entries, wellbeing, workouts, weights, labs, frictions] = await Promise.all([
      db.entries.toArray(), db.wellbeing.toArray(), db.workouts.toArray(), db.weights.toArray(), db.labs.toArray(), db.frictions.toArray(),
    ]);
    return [
      ...entries
        .filter((entry) => entry.status !== 'planned' || ('adherence' in entry && entry.adherence === 'uncertain'))
        // The event date can be historical even when the patient recorded its outcome today.
        // Prefer the explicit mark timestamp for every recorded outcome, not only uncertainty.
        .map((entry) => dateOf(entry.markedAt || entry.at)),
      ...wellbeing.map((entry) => entry.date),
      ...workouts.map((entry) => entry.date),
      ...weights.map((entry) => entry.date),
      ...labs.map((entry) => entry.date),
      ...frictions.map((entry) => dateOf(entry.at)),
    ].reduce((latest, recordedDate) => recordedDate <= todayISO() && recordedDate > latest ? recordedDate : latest, '');
  }, []);
  const [simple, setSimple] = useState<{ kind: Exclude<EntryKind, 'meal' | 'symptom'>; entry?: DayEntry } | null>(null);
  const [symptom, setSymptom] = useState<{ entry?: DayEntry } | null>(null); // D56

  const mode = activeMode(plan, date);
  const targets = observedTargets(effectiveTargets(plan, date), date, observation);
  const totals = entries && foods ? dayTotals(entries, foods) : undefined;
  const isToday = date === todayISO();
  const returningAfterBreak = isToday && !!lastRecordedDate &&
    differenceInCalendarDays(parseDay(todayISO()), parseDay(lastRecordedDate)) >= 7;
  // R06: «Усе з’їдене записано» — a mark of the day, made and taken back by the person
  const markComplete = async (on: boolean) => {
    const id = `food-complete-${date}`;
    if (on) await saved(db.entries.put({ id, at: atLocal(date, '23:59'), kind: 'note', status: 'done', title: t.summary.foodComplete, checkKey: FOOD_COMPLETE }), t.summary.foodComplete, () => db.entries.delete(id));
    else { const was = await db.entries.get(id); await saved(db.entries.delete(id), t.toast.deleted(t.summary.foodComplete), () => (was ? db.entries.put(was) : undefined)); }
  };
  const presentation = entries && foods && workouts ? presentDay({ plan, date, entries, workouts, foods,
    context, now: new Date(), observation, light, lastMealBy: targets.lastMealBy }) : undefined;
  const checklist = presentation?.checklist;
  const wellbeingToday = useLiveQuery(() => db.wellbeing.get(date).then((w) => w ?? null), [date]);

  /** UI-ACTION-01: an outcome is written against the record the person saw (a stale sheet writes nothing). */
  const setStatus = async (e: DayEntry, status: DayEntry['status'], skipReason?: string) => {
    setRowFor(null);
    const say = status === 'done' ? t.toast.done : status === 'skipped' ? t.toast.skipped : t.toast.backToPlan;
    await applyEntryChange(e, (current) => withStatus(current, status, skipReason), say(e.title));
  };
  const remove = (e: DayEntry) => applyEntryChange(e, () => null, t.toast.deleted(e.title));
  const [askMed, setAskMed] = useState<CheckItem | null>(null);
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
    if (kind === 'meal') setOpenTile(blockKeyFor(slotAt(new Date())));
    else if (kind === 'symptom') setSymptom({});
    else setSimple({ kind });
  };

  const rhythm = presentation?.rhythm;

  if (!observationReady) return <Loading />;
  return (
    <section>
      <DayHeader date={date} setDate={setDate} />
      {light && !isToday && <p className="mb-3 text-sm">{t.lightDay.enable}</p>}
      {enabled && isToday && <LightDayNotice date={date} />}
      {returningAfterBreak && <div role="status" aria-label={t.day.returningAfterBreak.title}
        className="mb-3 space-y-1 rounded-2xl border border-accent/30 bg-surface p-3 text-sm">
        <p className="font-medium">{t.day.returningAfterBreak.title}</p>
        <p className="text-muted">{t.day.returningAfterBreak.message}</p>
      </div>}

      <ExampleNotice plan={plan} />
      {/* ТЗ 17.11, step 3 (D164): the first screen — «Зараз», the quick marks, the food tiles and «Мені погано» */}
      <div data-testid="focused-day-now">
        {entries && <NowCard compact entries={entries} plan={plan} date={date} observation={observation} onConfirm={setConfirming} onReschedule={setRescheduling} />}
      </div>
      {entries && all && plan && <InjectionSiteCard day={entries} all={all} prescriptions={plan.prescriptions} /> /* D189 */}
      {isToday && entries && plan && <SideEffectsCard plan={plan} day={entries} /> /* D194 */}
      {checklist && entries && <QuickMarks date={date} isToday={isToday} light={light} items={checklist.items} entries={entries}
        fluid={dayFluid(entries, foods ?? new Map(), date)} targets={{ ...targets, ...(plan?.targets.waterMaxMl ? { waterMaxMl: plan.targets.waterMaxMl } : {}), ...(plan?.targets.waterFrom ? { waterFrom: plan.targets.waterFrom } : {}) }} /* D169 */
        wellbeing={wellbeingToday ?? undefined} workoutDone={!!workouts?.some((w) => w.date === date) || entries.some((e) => e.kind === 'workout' && e.status === 'done')}
        {...(plan?.rehab?.stages.length ? { rehab: { done: sessionsOn(entries, date).length, perDay: plan.rehab.perDay } } : {})} /* D179 */
        onWorkout={() => setSimple({ kind: 'workout' })} onUnwell={() => setSymptom({})} request={openMark} onRequestDone={() => setOpenMark(null)} />}
      {can('food.log') && date <= today && entries && all && foods && recipes && <MealTiles date={date} day={entries} all={all} foods={foods} recipes={recipes} plan={plan}
        quiet={light || !scoredDay(observation, 'food', date)} open={openTile} onOpen={(key) => { setListenTile(false); setOpenTile(key); setTileDraft(null); }} listen={listenTile} onConfirm={setConfirming}
        draft={tileDraft} onDraftDone={() => setTileDraft(null)} />}
      {can('food.log') && !light && entries && foodState(entries) !== 'none' && ( /* R06: only the person can say all food is written */
        <p className="-mt-2 mb-3 text-right"><button type="button" aria-pressed={foodState(entries) === 'complete'} onClick={() => void markComplete(foodState(entries) !== 'complete')}
          className="min-h-tap px-1 text-sm text-accent underline">{foodState(entries) === 'complete' ? t.summary.undoComplete : t.summary.markComplete}</button></p>)}
      {/* how the person feels: «Мені погано» and, beside it, the light day (D139) — one line on the first screen */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setSymptom({})} data-testid="unwell"
          className="flex min-h-tap min-w-[11rem] flex-1 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2 text-left font-semibold">
          <Frown size={20} className="shrink-0 text-muted" aria-hidden /><span className="flex-1">{t.addKinds.symptom}</span><ChevronRight size={18} className="text-muted" aria-hidden />
        </button>
        {enabled && <LightDayControl date={date} compact />}
      </div>
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
          <button type="button" onClick={() => navigate('/data')} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{t.backup.remindAction}</button>
        </div>
      )}

      {isToday && !codeDue && plan && !hasExample(plan) && <><PilotOffer /><PilotSurvey /></> /* D120, D121 */}
      {/* the day list: every dose, water and workout of the day, the done ones struck through (D164) */}
      {rhythm && <DayRhythm date={date} title={t.day.rhythm} rhythm={rhythm} foods={foods} {...(can('menu.yesterday') && can('food.log') ? { onYesterday: () => setYesterday(true) } : {})} addLabel={enabled ? t.modules.addOther : undefined} onEntry={(e) => (e.kind === 'meal' && e.status === 'planned' && e.items?.length ? setConfirming(e) : setRowFor(e))} onDose={setAskMed} onAdd={() => setAdding(true)}
        onAnytime={(i) => (i.kind === 'workout' ? navigate('/workout') : setAskMed(i))} />}

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
        <ActionDetail entry={rowFor} {...(foods ? { foods } : {})} {...(all ? { all } : {})} onClose={() => setRowFor(null)}>{(row) => <>
          {row.kind === 'med' && row.adherence === 'uncertain'
            ? <SheetButton tone="accent" onClick={() => {
              const item = checklist?.items.find((x) => x.kind === 'med' && x.key === row.checkKey);
              if (!item) return;
              setRowFor(null);
              setAskMed(item);
            }}><Check size={20} />{t.rowActions.resolveUncertain}</SheetButton>
            : row.kind !== 'symptom' && row.status !== 'done' && <SheetButton tone="accent" onClick={() => setStatus(row, 'done')}><Check size={20} />{t.rowActions.done}</SheetButton>}
          {row.kind !== 'symptom' && row.status !== 'skipped' && <SheetButton onClick={() => {
            if (row.kind === 'meal' || row.kind === 'med') { setSkippingRow(row); setRowFor(null); }
            else void setStatus(row, 'skipped');
          }}><X size={20} />{t.rowActions.skipped}</SheetButton>}
          {row.kind !== 'symptom' && (row.status !== 'planned' || row.adherence === 'uncertain') && <SheetButton onClick={() => setStatus(row, 'planned')}><Undo2 size={20} />{t.rowActions.planned}</SheetButton>}
          {row.kind === 'meal' && row.status === 'planned' && <SheetButton onClick={() => { setRescheduling(row); setRowFor(null); }}>{t.reschedule.action}</SheetButton>}
          <SheetButton onClick={() => edit(row)}><Pencil size={20} />{t.rowActions.edit}</SheetButton>
          {row.kind === 'meal' && !!row.items?.length && (
            <SheetButton onClick={() => { const e = row; setRowFor(null); void pinMeal(e.title, e.items!); }}><Star size={20} />{t.meal.pin}</SheetButton>
          )}
          <SheetButton tone="danger" onClick={() => { setRowFor(null); void remove(row); }}>
            <Trash2 size={20} />{t.rowActions.delete}</SheetButton>
        </>}</ActionDetail>
      )}
      {skippingRow && entryVisible(skippingRow, context) && <SkipChoice title={skippingRow.title} onClose={() => setSkippingRow(null)}
        onConfirm={(reason) => { const entry = skippingRow; setSkippingRow(null); void setStatus(entry, 'skipped', reason); }} />}
      {confirming && can('food.log') && <ConfirmMeal entry={confirming} date={date} foods={foods} onClose={() => setConfirming(null)}
        onReschedule={() => { setRescheduling(confirming); setConfirming(null); }}
        onEdit={() => { const e = confirming; setConfirming(null); edit(e); }}
        onPin={() => { const e = confirming; setConfirming(null); void pinMeal(e.title, e.items!); }}
        onDelete={() => { const e = confirming; setConfirming(null); void remove(e); }} />}
      {rescheduling && can('food.log') && entryVisible(rescheduling, context) && <RescheduleMeal entry={rescheduling} onClose={() => setRescheduling(null)} onMoved={e => setDate(dateOf(e.at))} />}
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
            {meals.length === 0 && <SheetButton tone="accent" onClick={() => { setYesterday(false); setOpenTile(blockKeyFor(slotAt(new Date()))); }}><UtensilsCrossed size={20} />{t.day.firstMeal}</SheetButton>}
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
      {askMed && can('meds.log') && <TimeChoice title={askMed.title} {...(askMed.time ? { planned: askMed.time } : {})} date={date} allowUncertain onClose={() => setAskMed(null)}
        onPick={(when) => void markMeds([{ key: askMed.key, title: askMed.title, ...(askMed.prescriptionId ? { prescriptionId: askMed.prescriptionId } : {}) }],
          date, askMed.time, 'done', when)} />}
      {symptom && all && <SymptomSheet date={date} {...(symptom.entry ? { entry: symptom.entry } : {})} all={all} {...(foods ? { foods } : {})} onClose={() => setSymptom(null)} />}
      {simple && can(ENTRY_FEATURES[simple.kind]) && <SimpleEntrySheet kind={simple.kind} entry={simple.entry} date={date} onClose={() => setSimple(null)} />}
      {/* ТЗ 17.11, step 3: the one field «Скажіть або напишіть…», pinned above the tabs (protocol-c2's OneInput goes here) */}
      {foods && recipes && all && <OneInput date={date} plan={plan} foods={foods} recipes={recipes} all={all} medItems={checklist?.items.filter((i) => i.kind === 'med') ?? []} can={can}
        lightDay={enabled && !context.demo && isToday && !light} /* D162: one field above the tabs */
        hidden={openTile != null && !tileDraft} /* D167: one field and one microphone; the field stays while its draft is in the tile */
        onFood={(draft) => { setOpenTile(blockKeyFor(slotAt(new Date()))); setTileDraft(draft); }} />}
    </section>
  );
}
