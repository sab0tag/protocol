import { differenceInMinutes, format } from 'date-fns';
import { EntryPreview } from '../components/EntryPreview';
import { pinMeal } from '../components/Favorites';
import { markMeds, TimeChoice } from '../components/MarkTime';
import { ConfirmMeal } from '../components/ConfirmMeal';
import { SymptomSheet } from '../components/SymptomSheet';
import { saved } from '../components/Toast';
import { Check, Droplet, Dumbbell, Frown, HeartPulse, ListChecks, NotebookPen, Pencil, Pill, Plus, Sparkles, Star, Target, Trash2, Undo2, UtensilsCrossed, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sheet, SheetButton } from '../components/Sheet';
import { db } from '../data/db';
import { useAllEntries, useDayEntries, useFoods, usePlan, useWorkouts } from '../data/queries';
import { buildChecklist, type CheckItem } from '../domain/checklist';
import { NOW_AFTER_MIN } from '../domain/reminders';
import { habits, mealsOf } from '../domain/habits';
import { addDays, parseISO as parseDay } from 'date-fns';
import { amountText } from '../domain/foodSearch';
import { exportDue } from '../data/backup';
import { useLiveQuery } from 'dexie-react-hooks';
import { atLocal, newId, timeOf, todayISO } from '../domain/dates';
import { activeMode, dayTotals, effectiveTargets } from '../domain/nutrition';
import type { DayEntry, EntryKind } from '../domain/types';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';
import { useSync } from '../sync/runner';
import { SimpleEntrySheet } from './SimpleEntrySheet';
import { NowCard } from '../components/NowCard';
import { QuickDock } from '../components/QuickDock';
import { DayHeader } from '../components/DayHeader';
import { DayRhythm } from '../components/DayRhythm';
import { ExampleNotice } from '../components/ExampleNotice';
import { DaySummary } from '../components/DaySummary';
import { dayRhythm } from '../domain/rhythm';
import { runningLow } from '../domain/stock';

const KIND_ICON = { meal: UtensilsCrossed, med: Pill, water: Droplet, workout: Dumbbell, note: NotebookPen, symptom: Frown } as const;

/** «День» (SPEC.md §5.1, §14.1, D53): the day by name and week, «Зараз», «Записати їжу», quick tiles, «Ритм дня» —
 *  the plan and the records on one time line — and «Уже сьогодні»; medicine and water float under the thumb. */
export function Day() {
  const { date, setDate } = useUi();
  // D34: a reminder opens its day (#/?date=…)
  const [params, setParams] = useSearchParams();
  const linked = params.get('date');
  useEffect(() => {
    if (linked && /^\d{4}-\d{2}-\d{2}$/.test(linked)) { setDate(linked); setParams({}, { replace: true }); }
  }, [linked, setDate, setParams]);
  const opening = params.get('open'); // D66: `#/do/symptom` lands here
  useEffect(() => {
    if (opening === 'symptom') { setSymptom({}); setParams({}, { replace: true }); }
  }, [opening, setParams]);
  const entries = useDayEntries(date);
  const foods = useFoods();
  const plan = usePlan();
  // D31: a recent sync is an encrypted copy too — no weekly «save a copy» nagging then
  const syncMeta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []); // D40: «код записаний?»
  const codeDue = !!syncMeta && Date.now() - (syncMeta.codeCheckedAt ?? 0) > 30 * 86_400_000;
  const syncLast = useSync((s) => (s.status === 'off' ? undefined : s.lastAt));
  const tips = [...new Set((entries ?? []).flatMap((e) => e.menu?.tips ?? []))]; // D33
  const syncedRecently = syncLast !== undefined && Date.now() - syncLast < 7 * 86_400_000;
  const workouts = useWorkouts();
  const firstEntry = useLiveQuery(() => db.entries.orderBy('at').first(), []);
  const navigate = useNavigate();
  const [rowFor, setRowFor] = useState<DayEntry | null>(null);
  const [confirming, setConfirming] = useState<DayEntry | null>(null); // D55
  const [adding, setAdding] = useState(false);
  const [yesterday, setYesterday] = useState(false);
  const all = useAllEntries();
  const best = foods && all && workouts
    ? habits({ plan, entries: all, workouts, foods, today: todayISO() }).filter((h) => h.streak >= 3).sort((a, b) => b.streak - a.streak)[0]
    : undefined; // D38
  const [simple, setSimple] = useState<{ kind: Exclude<EntryKind, 'meal' | 'symptom'>; entry?: DayEntry } | null>(null);
  const [symptom, setSymptom] = useState<{ entry?: DayEntry } | null>(null); // D56

  const mode = activeMode(plan, date);
  const targets = effectiveTargets(plan, date);
  const totals = entries && foods ? dayTotals(entries, foods) : undefined;
  const isToday = date === todayISO();
  const checklist = entries && foods && workouts ? buildChecklist({ plan, date, entries, workouts, foods, now: new Date() }) : undefined;

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
  const dockWater = async () => { const e = waterRow(); await db.entries.add(e); return () => db.entries.delete(e.id); };
  const dockMed = async () => {
    if (!nextMed) return undefined;
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
    if (kind === 'meal') navigate('/meal/new');
    else if (kind === 'symptom') setSymptom({});
    else setSimple({ kind });
  };

  const rhythm = entries ? dayRhythm({ entries, ...(checklist ? { checklist } : {}), ...(targets.lastMealBy ? { lastMealBy: targets.lastMealBy } : {}) }) : undefined;
  const quick = [
    { label: t.menu.quick, Icon: Sparkles, go: () => navigate(`/menu?date=${date}`) },
    { label: t.day.likeYesterday, Icon: Undo2, go: () => setYesterday(true) },
    { label: t.well.short, Icon: HeartPulse, go: () => navigate('/wellbeing') },
    { label: t.workout.title, Icon: Dumbbell, go: () => navigate('/workout'), done: !!workouts?.some((w) => w.date === date) },
    { label: t.myday.title, Icon: ListChecks, go: () => navigate('/my-day'), badge: checklist && checklist.total > 0 ? t.myday.counter(checklist.done, checklist.total) : undefined },
  ];

  return (
    <section>
      <DayHeader date={date} setDate={setDate} />

      {entries && <NowCard entries={entries} plan={plan} date={date} onConfirm={setConfirming} />}

      <ExampleNotice plan={plan} />
      {/* D40: one notice at a time — the code first, then the backup */}
      {isToday && codeDue && (
        <div role="status" className="mb-3 space-y-2 rounded-2xl border border-line bg-surface p-3 text-sm">
          <p>{t.sync.codeCheck}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void saved(db.meta.update('sync', { codeCheckedAt: Date.now() }), t.sync.codeKept)}
              className="min-h-tap rounded-xl border border-line px-3">{t.sync.codeCheckYes}</button>
            <button type="button" onClick={() => navigate('/sync')} className="min-h-tap rounded-xl border border-accent px-3 font-medium text-accent">{t.sync.codeCheckShow}</button>
          </div>
        </div>
      )}
      {!codeDue && !syncedRecently && exportDue(plan?.lastExportAt, firstEntry?.at.slice(0, 10), todayISO()) && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-2xl border border-warn/30 bg-warn-bg p-3 text-sm text-warn">
          <span className="flex-1">{plan?.lastExportAt ? t.backup.remind : t.backup.remindFirst}</span>
          <button type="button" onClick={() => navigate('/more')} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{t.backup.remindAction}</button>
        </div>
      )}

      {isToday && plan && all && runningLow(plan.prescriptions, all).map(({ p, days }) => ( /* D69: buy in time */
        <div key={p.id} role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-warn/30 bg-warn-bg p-3 text-sm text-warn">
          <span className="flex-1">{t.stock.low(p.title, days)}</span>
          <button type="button" onClick={() => navigate('/plan')} className="min-h-tap rounded-xl border border-warn px-3 font-medium">{t.stock.update}</button>
        </div>
      ))}

      {/* D53: recording food is one strong button on «День», not a row under a table */}
      <div className="mb-4 flex gap-2">
        <button type="button" onClick={() => navigate('/meal/new')}
          className="flex min-h-[3.5rem] flex-1 items-center justify-center gap-2 rounded-2xl border border-accent/40 bg-surface text-lg font-semibold text-accent shadow-sm">
          <UtensilsCrossed size={22} aria-hidden />{t.day.recordFood}</button>
        {/* D56: a symptom with its time, next to the food it may follow */}
        <button type="button" onClick={() => setSymptom({})}
          className="flex min-h-[3.5rem] shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface px-3 font-medium shadow-sm">
          <Frown size={20} className="text-warn" aria-hidden />{t.addKinds.symptom}</button>
      </div>

      <nav aria-label={t.day.quick} className="mb-5 grid grid-cols-5 gap-1">
        {quick.map(({ label, Icon, go, badge, done }) => (
          <button key={label} type="button" onClick={go} aria-label={done ? `${label}, ${t.myday.workoutDone}` : undefined} className="flex min-h-tap flex-col items-center gap-1 text-center">
            <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-surface shadow-sm"><Icon size={22} className="text-accent" aria-hidden />
              {badge && <span className="tabular absolute -right-2 -top-1.5 rounded-full bg-accent px-1.5 text-xs font-medium text-surface">{badge}</span>}
              {done && <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-bg bg-accent text-surface" aria-hidden><Check size={11} strokeWidth={3} /></span>}</span>
            <span className="text-xs leading-tight">{label}</span>
          </button>
        ))}
      </nav>

      {plan?.weekGoal && ( /* D72: the week's goal, the person's own */
        <button type="button" onClick={() => navigate('/week')} className="mb-4 flex min-h-tap w-full items-center gap-2 rounded-2xl border border-line bg-surface px-3 text-left text-sm">
          <Target size={18} className="shrink-0 text-accent" aria-hidden /><span className="text-muted">{t.week.dayLine}:</span><span className="font-medium">{plan.weekGoal.text}</span>
        </button>
      )}

      {mode && (
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

      {rhythm && <DayRhythm rhythm={rhythm} foods={foods} onEntry={(e) => (e.kind === 'meal' && e.status === 'planned' && e.items?.length ? setConfirming(e) : setRowFor(e))} onDose={setAskMed} onAdd={() => setAdding(true)}
        onAnytime={(i) => (i.kind === 'workout' ? navigate('/workout') : setAskMed(i))} />}

      {tips.length > 0 && (
        <details className="mb-4 rounded-2xl border border-line bg-surface p-3">
          <summary className="min-h-tap cursor-pointer py-1 font-medium">{t.menu.tips}</summary>
          <ul className="list-disc space-y-1 pl-5 text-sm">{tips.map((x) => <li key={x}>{x}</li>)}</ul>
        </details>
      )}

      {totals && <DaySummary totals={totals} targets={targets} meds={{ done: meds.filter((i) => i.done).length, total: meds.length }}
        {...(isToday && best ? { streak: t.day.streak(t.progress.habit[best.key], best.streak) } : {})} />}

      {rowFor && (
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
      {confirming && <ConfirmMeal entry={confirming} date={date} foods={foods} onClose={() => setConfirming(null)}
        onEdit={() => { const e = confirming; setConfirming(null); edit(e); }}
        onPin={() => { const e = confirming; setConfirming(null); void pinMeal(e.title, e.items!); }}
        onDelete={() => { const e = confirming; setConfirming(null); void saved(db.entries.delete(e.id), t.toast.deleted(e.title), () => db.entries.put(e)); }} />}
      {adding && (
        <Sheet title={t.day.addRow} onClose={() => setAdding(false)}>
          {(Object.keys(KIND_ICON) as EntryKind[]).map((k) => {
            const Icon = KIND_ICON[k];
            return <SheetButton key={k} onClick={() => startAdd(k)}><Icon size={20} />{t.addKinds[k]}</SheetButton>;
          })}
        </Sheet>
      )}
      {yesterday && all && (() => {
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
      {checklist && (
        <>
          <div className="h-40 md:h-16" aria-hidden />{/* D48: the end of the day stays visible above the dock */}
          <QuickDock meds={{ done: meds.filter((i) => i.done).length, total: meds.length }} water={checklist.water}
            med={nextMed && { title: nextMed.title, ...(nextMed.time ? { time: nextMed.time } : {}), missed: medMissed }}
            onMed={dockMed} onWater={dockWater} />
        </>
      )}
      {askMed && <TimeChoice title={askMed.title} {...(askMed.time ? { planned: askMed.time } : {})} date={date} onClose={() => setAskMed(null)}
        onPick={(when) => void markMeds([{ key: askMed.key, title: askMed.title, ...(askMed.prescriptionId ? { prescriptionId: askMed.prescriptionId } : {}) }],
          date, askMed.time, 'done', when)} />}
      {symptom && all && <SymptomSheet date={date} {...(symptom.entry ? { entry: symptom.entry } : {})} all={all} {...(foods ? { foods } : {})} onClose={() => setSymptom(null)} />}
      {simple && <SimpleEntrySheet kind={simple.kind} entry={simple.entry} date={date} onClose={() => setSimple(null)} />}
    </section>
  );
}
