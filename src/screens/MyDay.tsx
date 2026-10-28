import { format, parseISO } from 'date-fns';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { uk } from 'date-fns/locale';
import { Activity, Check, ChevronLeft, ChevronRight, Circle, Dumbbell, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db } from '../data/db';
import { useDayEntries, useFoods, usePlan, useWorkouts } from '../data/queries';
import { buildChecklist, WATER_SEGMENT_ML, WATER_SEGMENTS, type CheckItem } from '../domain/checklist';
import { atLocal, newId, todayISO } from '../domain/dates';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';
import { useObservation } from '../app/observation';
import { ProgressTrack } from '../components/ProgressTrack';
import { ExampleNotice } from '../components/ExampleNotice';

const M = t.myday;

/** «Мій день» (SPEC.md §5.4): one tap per item, the time of the tick is kept. */
export function MyDay() {
  const { date, shift } = useUi();
  const { observation, ready: observationReady } = useObservation();
  const plan = usePlan();
  const entries = useDayEntries(date);
  const foods = useFoods();
  const workouts = useWorkouts();
  const navigate = useNavigate();
  if (!entries || !foods || !workouts || !observationReady) return <Loading />;

  const isToday = date === todayISO();
  const c = buildChecklist({ plan, date, entries, workouts, foods, now: new Date(), observation });
  const stamp = (scheduled?: string) => atLocal(date, isToday ? format(new Date(), 'HH:mm') : scheduled ?? '12:00');

  const toggle = async (item: CheckItem) => {
    if (item.kind === 'workout') return navigate('/workout');
    if (!item.tappable) return;
    const tick = entries.find((e) => e.checkKey === item.key && e.status === 'done');
    if (tick) return saved(db.entries.delete(tick.id), t.toast.medUndone(item.title), () => db.entries.put(tick));
    const id = newId();
    await saved(db.entries.add({
      at: stamp(item.kind === 'dinner' ? plan?.targets.lastMealBy : item.time), status: 'done', checkKey: item.key,
      ...(item.kind === 'med' ? { kind: 'med' as const, title: item.title, ...(item.prescriptionId ? { prescriptionId: item.prescriptionId } : {}) }
        : { kind: 'note' as const, title: item.title }),
      id,
    }), t.toast.ticked(item.title), () => db.entries.delete(id));
  };
  const addWater = () => { const id = newId(); return saved(db.entries.add({ id, at: stamp(), kind: 'water', status: 'done', title: t.addKinds.water, waterMl: WATER_SEGMENT_ML }),
    t.toast.water(WATER_SEGMENT_ML), () => db.entries.delete(id)); };

  return (
    <section className="space-y-4 pt-4">
      <header className="protocol-scene-header mb-3 flex items-center gap-2">
        <button type="button" onClick={() => shift(-1)} aria-label={t.day.prev}
          className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line bg-surface"><ChevronLeft size={20} /></button>
        <div className="flex-1 text-center">
          <h1 className="text-xl font-semibold">{M.title} <span className="tabular text-accent">{M.counter(c.done, c.total)}</span></h1>
          <p className="text-sm text-muted first-letter:uppercase">{format(parseISO(date), 'EEEE, d MMMM', { locale: uk })}</p>
        </div>
        <button type="button" onClick={() => shift(1)} aria-label={t.day.next}
          className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line bg-surface"><ChevronRight size={20} /></button>
      </header>
      <ExampleNotice plan={plan} />
      {c.total > 0 && <ProgressTrack ratio={c.done / c.total} label={M.title} valueText={M.counter(c.done, c.total)} />}

      {c.total === 0 && <p className="protocol-card rounded-2xl border border-line bg-surface p-4 text-muted">{M.empty}</p>}
      <ul className="divide-y divide-line overflow-hidden protocol-card rounded-2xl border border-line bg-surface">
        {c.items.map((item) => (
          <li key={item.key}>
            <button type="button" onClick={() => void toggle(item)} disabled={!item.tappable && item.kind !== 'workout'}
              aria-pressed={item.tappable ? item.done : undefined}
              className="flex min-h-tap w-full items-center gap-3 px-4 py-4 text-left disabled:cursor-default">
              {item.done ? <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-surface"><Check size={16} aria-hidden /></span>
                : item.kind === 'workout' ? <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-line text-muted"><Dumbbell size={13} aria-hidden /></span>
                  : <Circle size={24} className="text-line" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className={`block font-medium ${item.done ? 'text-muted line-through decoration-accent/50' : ''}`}>{item.title}</span>
                {item.detail && <span className="block text-sm text-muted">{item.detail}</span>}
              </span>
              <span className="tabular shrink-0 text-sm">
                {item.doneAt && <span className="text-accent">{M.doneAt(item.doneAt)}</span>}
                {item.kind === 'workout' && <span className={item.done ? 'font-medium text-accent' : 'text-accent'}>{item.done ? M.workoutDone : M.workoutOpen}</span>}
                {item.minutesLeft != null && <span className="font-medium text-warn">{M.minutesLeft(item.minutesLeft)}</span>}
                {item.late && <span className="text-muted">{M.late}</span>}
              </span>
            </button>
            {item.kind === 'water' && (
              <div className="flex gap-1 px-3 pb-3" role="group" aria-label={M.water(c.water.ml, c.water.target)}>
                {Array.from({ length: WATER_SEGMENTS }, (_, i) => (
                  <button key={i} type="button" onClick={() => void addWater()} aria-label={M.addSegment}
                    className={`h-11 flex-1 rounded-md ${i < c.water.segments ? 'bg-water' : 'bg-line'}`} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {c.workoutNote && (
        <p className="mt-3 flex items-start gap-2 protocol-card rounded-2xl border border-line bg-surface p-3 text-sm"><Info size={18} className="mt-0.5 shrink-0 text-muted" />{c.workoutNote}</p>
      )}
      <button type="button" onClick={() => navigate('/wellbeing')}
        className="mt-3 flex min-h-tap w-full items-center gap-3 protocol-card rounded-2xl border border-line bg-surface px-3 font-medium">
        <Activity size={20} className="text-accent" />{M.wellbeing}</button>
    </section>
  );
}
