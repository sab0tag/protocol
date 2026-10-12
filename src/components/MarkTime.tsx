// D52: a mark made later never gets an invented time. «Відмітити» asks when it really happened: just now, at the
// planned time (said by the person, not assumed), another time — or «час не пам'ятаю», kept as unknown. The plan's
// time stays apart (a medicine's in its checkKey, a meal's in `plannedAt`), and so does the moment of the mark.
import { format } from 'date-fns';
import { AlarmClock, Clock, HelpCircle, History } from 'lucide-react';
import { useState } from 'react';
import { db } from '../data/db';
import { atLocal, newId, todayISO } from '../domain/dates';
import type { DayEntry } from '../domain/types';
import { t } from '../i18n/uk';
import { Sheet, SheetButton } from './Sheet';
import { saved } from './Toast';

const L = t.mark;

/** The confirmed real time, or none («не пам'ятаю»). */
export type When = { time: string } | { unknown: true };
export interface MedMark { key: string; title: string; prescriptionId?: string }

const nowAt = () => atLocal(todayISO(), format(new Date(), 'HH:mm'));
const marks = (when: When) => ({ markedAt: nowAt(), ...('unknown' in when ? { timeUnknown: true as const } : {}) });
const say = (title: string, status: 'done' | 'skipped', when?: When) =>
  status === 'skipped' ? t.toast.skipped(title) : t.toast.marked(title, when && 'time' in when ? when.time : undefined);

/** Medicines of one planned time: taken (when) or skipped; a skipped dose has no real time, it keeps the planned one. */
export function markMeds(meds: MedMark[], date: string, planned: string | undefined, status: 'done' | 'skipped', when: When) {
  const ids = meds.map(() => newId());
  const time = 'time' in when ? when.time : planned ?? '12:00';
  const title = meds.map((m) => m.title).join(', ');
  return saved(db.entries.bulkAdd(meds.map((m, i): DayEntry => ({ id: ids[i]!, at: atLocal(date, time), kind: 'med', status, title: m.title,
    checkKey: m.key, ...(m.prescriptionId ? { prescriptionId: m.prescriptionId } : {}), ...marks(when) }))),
  say(title, status, when), () => db.entries.bulkDelete(ids));
}

/** A planned meal: eaten (when) or skipped; the plan's time is kept as `plannedAt` when the real one differs. */
export function markMeal(e: DayEntry, date: string, status: 'done' | 'skipped', when: When) {
  const at = 'time' in when ? atLocal(date, when.time) : e.at;
  const next: DayEntry = { ...e, status, at, ...(at !== e.at ? { plannedAt: e.plannedAt ?? e.at } : {}), ...marks(when) };
  return saved(db.entries.put(next), say(e.title, status, when), () => db.entries.put(e));
}

/** «Коли?» — the choice before a late mark. `planned` is the plan's time; «Щойно» only for today. */
export function TimeChoice({ title, planned, date, meal, onPick, onClose }: {
  title: string; planned?: string; date: string; meal?: boolean; onPick: (when: When) => void; onClose: () => void;
}) {
  const [other, setOther] = useState<string | null>(null);
  const now = format(new Date(), 'HH:mm');
  const pick = (when: When) => { onClose(); onPick(when); };
  return (
    <Sheet title={`${title} — ${meal ? L.whenAte : L.whenTook}`} onClose={onClose}>
      {date === todayISO() && <SheetButton onClick={() => pick({ time: now })}><Clock size={20} />{L.justNow(now)}</SheetButton>}
      {planned && <SheetButton onClick={() => pick({ time: planned })}><History size={20} />{L.asPlanned(planned)}</SheetButton>}
      {other === null
        ? <SheetButton onClick={() => setOther(planned ?? now)}><AlarmClock size={20} />{L.other}</SheetButton>
        : (
          <form className="flex items-end gap-2 px-3 py-1" onSubmit={(e) => { e.preventDefault(); if (other) pick({ time: other }); }}>
            <label className="block flex-1"><span className="text-sm text-muted">{L.other}</span>
              <input type="time" value={other} onChange={(e) => setOther(e.target.value)} required autoFocus
                className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
            <button type="submit" className="min-h-tap rounded-xl bg-accent px-4 font-medium text-surface">{L.save}</button>
          </form>
        )}
      <SheetButton onClick={() => pick({ unknown: true })}><HelpCircle size={20} />{L.unknown}</SheetButton>
    </Sheet>
  );
}
