import { format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';
import { Activity, Check, ChevronLeft, ListChecks, ChevronRight, Droplet, NotebookPen, Pill, Plus, Dumbbell, Undo2, UtensilsCrossed, X, Pencil, Trash2, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sheet, SheetButton } from '../components/Sheet';
import { db } from '../data/db';
import { useAllEntries, useDayEntries, useFoods, usePlan, useWorkouts } from '../data/queries';
import { buildChecklist } from '../domain/checklist';
import { habits, mealsOf } from '../domain/habits';
import { addDays, parseISO as parseDay } from 'date-fns';
import { amountText } from '../domain/foodSearch';
import { exportDue } from '../data/backup';
import { useLiveQuery } from 'dexie-react-hooks';
import { atLocal, newId, timeOf, todayISO } from '../domain/dates';
import { activeMode, dayTotals, effectiveTargets, mealNutrients, round } from '../domain/nutrition';
import type { DayEntry, EntryKind, Food } from '../domain/types';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';
import { useSync } from '../sync/runner';
import { SimpleEntrySheet } from './SimpleEntrySheet';
import { NowCard } from '../components/NowCard';

const KIND_ICON = { meal: UtensilsCrossed, med: Pill, water: Droplet, workout: Dumbbell, note: NotebookPen } as const;

/** «День» as an order sheet: rows by time (Час · Позиція · Вугл), the day's totals against the targets. */
export function Day() {
  const { date, shift, setDate } = useUi();
  // D34: a reminder opens its day (#/?date=…)
  const [params, setParams] = useSearchParams();
  const linked = params.get('date');
  useEffect(() => {
    if (linked && /^\d{4}-\d{2}-\d{2}$/.test(linked)) { setDate(linked); setParams({}, { replace: true }); }
  }, [linked, setDate, setParams]);
  const entries = useDayEntries(date);
  const foods = useFoods();
  const plan = usePlan();
  // D31: a recent sync is an encrypted copy too — no weekly «save a copy» nagging then
  const syncLast = useSync((s) => (s.status === 'off' ? undefined : s.lastAt));
  const tips = [...new Set((entries ?? []).flatMap((e) => e.menu?.tips ?? []))]; // D33
  const syncedRecently = syncLast !== undefined && Date.now() - syncLast < 7 * 86_400_000;
  const workouts = useWorkouts();
  const firstEntry = useLiveQuery(() => db.entries.orderBy('at').first(), []);
  const navigate = useNavigate();
  const [rowFor, setRowFor] = useState<DayEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [yesterday, setYesterday] = useState(false);
  const all = useAllEntries();
  const best = foods && all && workouts
    ? habits({ plan, entries: all, workouts, foods, today: todayISO() }).filter((h) => h.streak >= 3).sort((a, b) => b.streak - a.streak)[0]
    : undefined; // D38
  const [simple, setSimple] = useState<{ kind: Exclude<EntryKind, 'meal'>; entry?: DayEntry } | null>(null);

  const mode = activeMode(plan, date);
  const targets = effectiveTargets(plan, date);
  const totals = entries && foods ? dayTotals(entries, foods) : undefined;
  const isToday = date === todayISO();
  const checklist = entries && foods && workouts ? buildChecklist({ plan, date, entries, workouts, foods, now: new Date() }) : undefined;

  const setStatus = async (e: DayEntry, status: DayEntry['status']) => {
    await db.entries.put({ ...e, status });
    setRowFor(null);
  };
  const addWater = async () => {
    const time = isToday ? format(new Date(), 'HH:mm') : '12:00';
    await db.entries.add({ id: newId(), at: atLocal(date, time), kind: 'water', status: 'done', title: t.addKinds.water, waterMl: 250 });
  };
  const nextMed = checklist?.items.find((i) => i.kind === 'med' && !i.done);
  const tickMed = async () => {
    if (!nextMed) return;
    const time = isToday ? format(new Date(), 'HH:mm') : nextMed.time ?? '12:00';
    await db.entries.add({ id: newId(), at: atLocal(date, time), kind: 'med', status: 'done', title: nextMed.title, checkKey: nextMed.key,
      ...(nextMed.prescriptionId ? { prescriptionId: nextMed.prescriptionId } : {}) });
  };
  const prevDay = format(addDays(parseDay(date), -1), 'yyyy-MM-dd');
  const copyMeal = async (e: DayEntry) => {
    const time = timeOf(e.at);
    const future = date > todayISO() || (isToday && time > format(new Date(), 'HH:mm'));
    await db.entries.add({ ...e, id: newId(), at: atLocal(date, time), status: future ? 'planned' : 'done' });
  };

  const edit = (e: DayEntry) => {
    setRowFor(null);
    if (e.kind === 'meal') navigate(`/meal/${e.id}`);
    else setSimple({ kind: e.kind, entry: e });
  };
  const startAdd = (kind: EntryKind) => {
    setAdding(false);
    if (kind === 'meal') navigate('/meal/new');
    else setSimple({ kind });
  };

  return (
    <section className="pt-4">
      <header className="mb-3 flex items-center gap-2">
        <button type="button" className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line bg-surface"
          onClick={() => shift(-1)} aria-label={t.day.prev}><ChevronLeft size={20} /></button>
        <h1 className="flex-1 text-center text-xl font-semibold first-letter:uppercase">
          {format(parseISO(date), 'EEEE, d MMMM', { locale: uk })}
        </h1>
        <button type="button" className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line bg-surface"
          onClick={() => shift(1)} aria-label={t.day.next}><ChevronRight size={20} /></button>
      </header>
      {!isToday && (
        <p className="-mt-1 mb-3 text-center">
          <button type="button" className="min-h-tap px-3 text-accent underline" onClick={() => setDate(todayISO())}>{t.day.today}</button>
        </p>
      )}

      {isToday && entries && <NowCard entries={entries} plan={plan} date={date} />}

      {!syncedRecently && exportDue(plan?.lastExportAt, firstEntry?.at.slice(0, 10), todayISO()) && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-2xl border border-warn/30 bg-warn-bg p-3 text-sm text-warn">
          <span className="flex-1">{plan?.lastExportAt ? t.backup.remind : t.backup.remindFirst}</span>
          <button type="button" onClick={() => navigate('/more')} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{t.backup.remindAction}</button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t.day.quick}>
        <button type="button" onClick={() => void addWater()}
          className="flex min-h-tap items-center gap-1 rounded-full border border-line bg-surface px-3 font-medium text-water"><Droplet size={16} aria-hidden />{t.day.plusWater}</button>
        {nextMed && (
          <button type="button" onClick={() => void tickMed()}
            className="flex min-h-tap items-center gap-1 rounded-full border border-line bg-surface px-3 font-medium"><Pill size={16} className="text-accent" aria-hidden />{t.day.medDone(nextMed.title)}</button>
        )}
        <button type="button" onClick={() => setYesterday(true)}
          className="flex min-h-tap items-center gap-1 rounded-full border border-line bg-surface px-3 font-medium"><Undo2 size={16} className="text-accent" aria-hidden />{t.day.likeYesterday}</button>
        <button type="button" onClick={() => navigate(`/menu?date=${date}`)}
          className="flex min-h-tap items-center gap-1 rounded-full border border-line bg-surface px-3 font-medium"><Sparkles size={16} className="text-accent" aria-hidden />{t.menu.quick}</button>
      </div>

      {isToday && best && <p className="mb-3 text-sm text-accent">{t.day.streak(t.progress.habit[best.key], best.streak)}</p>}

      {tips.length > 0 && (
        <details className="mb-3 rounded-2xl border border-line bg-surface p-3">
          <summary className="min-h-tap cursor-pointer py-1 font-medium">{t.menu.tips}</summary>
          <ul className="list-disc space-y-1 pl-5 text-sm">{tips.map((x) => <li key={x}>{x}</li>)}</ul>
        </details>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => navigate('/my-day')}
          className="flex min-h-tap items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 font-medium">
          <ListChecks size={18} className="text-accent" aria-hidden />{t.myday.title}
          {checklist && checklist.total > 0 && <span className="tabular text-accent">{t.myday.counter(checklist.done, checklist.total)}</span>}
        </button>
        <button type="button" onClick={() => navigate('/wellbeing')}
          className="flex min-h-tap items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 font-medium">
          <Activity size={18} className="text-accent" aria-hidden />{t.well.title}</button>
      </div>

      {mode && (
        <div className="mb-3 rounded-2xl border border-accent/30 bg-accent/10 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{mode.mode.title}</span>
            <span className="text-sm text-muted">{t.day.modeDay(mode.day, mode.of)}</span>
          </div>
          {mode.mode.notes.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm">{mode.mode.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="grid grid-cols-[3.5rem_1fr_3.5rem] gap-2 border-b border-line px-3 py-2 text-xs uppercase tracking-wide text-muted">
          <span>{t.day.colTime}</span><span>{t.day.colItem}</span><span className="text-right">{t.day.colCarbs}</span>
        </div>
        {entries?.length === 0 && <p className="px-3 py-6 text-center text-muted">{t.day.empty}</p>}
        <ul>
          {entries?.map((e) => <Row key={e.id} entry={e} foods={foods} onOpen={() => setRowFor(e)} />)}
        </ul>
        <button type="button" onClick={() => setAdding(true)}
          className="flex min-h-tap w-full items-center justify-center gap-2 border-t border-line font-medium text-accent">
          <Plus size={18} aria-hidden />{t.day.addRow}
        </button>
      </div>

      {totals && (
        <div className="mt-4 rounded-2xl border border-line bg-surface p-3">
          <h2 className="mb-2 font-semibold">{t.day.totals}</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 tabular">
            <Total label={t.day.carbs} value={`${round(totals.carbs)} ${t.units.g}`}
              target={targets.carbsG?.min != null ? t.day.atLeast(targets.carbsG.min)
                : targets.carbsG?.max != null ? t.day.atMost(targets.carbsG.max) : undefined}
              alert={(targets.carbsG?.max != null && totals.carbs > targets.carbsG.max)} />
            <Total label={t.day.protein} value={`${round(totals.protein)} ${t.units.g}`}
              target={targets.proteinG != null ? `${targets.proteinG} ${t.units.g}` : undefined} />
            <Total label={t.day.calcium} value={`${round(totals.calciumMg)} ${t.units.mg}`}
              target={targets.calciumMg != null ? `${targets.calciumMg} ${t.units.mg}` : undefined} />
            <div>
              <dt className="text-sm text-muted">{t.day.water}</dt>
              <dd className="flex flex-wrap items-center gap-x-2">
                <span className="whitespace-nowrap">{totals.waterMl} / {targets.waterMl ?? '—'} {t.units.ml}</span>
                <button type="button" onClick={addWater}
                  className="min-h-tap whitespace-nowrap rounded-xl text-sm font-medium text-water">{t.day.plusWater}</button>
              </dd>
            </div>
            <Total label={t.day.kcal} value={`${round(totals.kcal)}`}
              target={targets.kcal != null ? `${targets.kcal} ${t.units.kcal}` : undefined} />
          </dl>
        </div>
      )}

      {rowFor && (
        <Sheet title={rowFor.title} onClose={() => setRowFor(null)}>
          {rowFor.status !== 'done' && <SheetButton tone="accent" onClick={() => setStatus(rowFor, 'done')}><Check size={20} />{t.rowActions.done}</SheetButton>}
          {rowFor.status !== 'skipped' && <SheetButton onClick={() => setStatus(rowFor, 'skipped')}><X size={20} />{t.rowActions.skipped}</SheetButton>}
          {rowFor.status !== 'planned' && <SheetButton onClick={() => setStatus(rowFor, 'planned')}><Undo2 size={20} />{t.rowActions.planned}</SheetButton>}
          <SheetButton onClick={() => edit(rowFor)}><Pencil size={20} />{t.rowActions.edit}</SheetButton>
          <SheetButton tone="danger" onClick={async () => { await db.entries.delete(rowFor.id); setRowFor(null); }}>
            <Trash2 size={20} />{t.rowActions.delete}</SheetButton>
        </Sheet>
      )}
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
            {meals.length === 0 && <p className="text-muted">{t.day.yesterdayEmpty}</p>}
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
      {simple && <SimpleEntrySheet kind={simple.kind} entry={simple.entry} date={date} onClose={() => setSimple(null)} />}
    </section>
  );
}

function Row({ entry, foods, onOpen }: { entry: DayEntry; foods?: Map<string, Food>; onOpen: () => void }) {
  const Icon = KIND_ICON[entry.kind];
  const carbs = entry.kind === 'meal' && entry.items && foods ? round(mealNutrients(entry.items, foods).carbs) : null;
  const detail = entry.kind === 'meal' ? entry.items?.map((i) => `${i.name} ${amountText(i)}`).join(', ')
    : entry.kind === 'water' ? `${entry.waterMl ?? 0} ${t.units.ml}` : undefined;
  const look = entry.status === 'planned' ? 'bg-accent/5 border-l-4 border-l-accent'
    : entry.status === 'skipped' ? 'opacity-50' : '';
  return (
    <li className="border-t border-line first:border-t-0">
      <button type="button" onClick={onOpen} aria-label={`${entry.title}, ${t.status[entry.status]}`}
        className={`grid min-h-tap w-full grid-cols-[3.5rem_1fr_3.5rem] items-center gap-2 px-3 py-2 text-left ${look}`}>
        <span className="tabular text-muted">{timeOf(entry.at)}</span>
        <span className="min-w-0">
          <span className={`flex items-center gap-1.5 ${entry.status === 'skipped' ? 'line-through' : ''}`}>
            <Icon size={16} className="shrink-0 text-muted" aria-hidden />
            <span className="truncate font-medium">{entry.title}</span>
            {entry.status === 'done' && <Check size={16} className="shrink-0 text-accent" aria-label={t.status.done} />}
          </span>
          {detail && <span className="block truncate text-sm text-muted">{detail}</span>}
        </span>
        <span className="tabular text-right">{carbs ?? ''}</span>
      </button>
    </li>
  );
}

function Total({ label, value, target, alert }: { label: string; value: string; target?: string; alert?: boolean }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={alert ? 'font-semibold text-warn' : ''}>{value}{target && <span className="text-muted"> / {target}</span>}</dd>
    </div>
  );
}
