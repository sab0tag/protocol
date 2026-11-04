import { format } from 'date-fns';
import { useState } from 'react';
import { db } from '../data/db';
import { MealScheduleError, rescheduleMeal, undoMealSchedule } from '../data/mealSchedule';
import { atLocal, todayISO } from '../domain/dates';
import type { DayEntry } from '../domain/types';
import { t } from '../i18n/uk';
import { Sheet } from './Sheet';
import { saved, toast } from './Toast';
import { ScheduleHistory } from './ScheduleHistory';

const L = t.reschedule;

export function RescheduleMeal({ entry, onClose, onMoved }: { entry: DayEntry; onClose: () => void; onMoved: (entry: DayEntry) => void }) {
  const [suggested] = useState(() => new Date(Math.max(Date.now() + 30 * 60_000, Date.parse(entry.at))));
  const [date, setDate] = useState(() => format(suggested, 'yyyy-MM-dd'));
  const [time, setTime] = useState(() => format(suggested, 'HH:mm'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const change = await rescheduleMeal(db, entry, atLocal(date, time));
      onClose(); onMoved(change.after);
      toast(L.saved(format(new Date(change.after.at), 'dd.MM HH:mm')), {
        undo: () => saved(undoMealSchedule(db, change).then(() => onMoved(change.before)), L.restored),
      });
    } catch (e) {
      setError(e instanceof MealScheduleError ? L.errors[e.code] : t.toast.failed);
      setBusy(false);
    }
  };
  return <Sheet title={L.title(entry.title)} onClose={() => { if (!busy) onClose(); }}>
    <form className="space-y-3" aria-busy={busy} onSubmit={e => { e.preventDefault(); void submit(); }}>
      <p className="text-sm text-muted">{L.hint}</p>
      <ScheduleHistory entry={entry} />
      <label className="block text-sm">{L.date}
        <input type="date" required min={todayISO()} value={date} onChange={e => setDate(e.target.value)} disabled={busy}
          className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
      <label className="block text-sm">{L.time}
        <input type="time" required value={time} onChange={e => setTime(e.target.value)} disabled={busy}
          className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="min-h-tap flex-1 rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-50">{busy ? L.saving : L.action}</button>
        <button type="button" onClick={onClose} disabled={busy} className="min-h-tap rounded-xl border border-line px-4">{t.simple.cancel}</button>
      </div>
    </form>
  </Sheet>;
}
