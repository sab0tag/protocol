// D52: a mark made later never gets an invented time. «Відмітити» asks when it really happened: just now, at the
// planned time (said by the person, not assumed), another time — or «час не пам'ятаю», kept as unknown. The plan's
// time stays apart (a medicine's in its checkKey, a meal's in `plannedAt`), and so does the moment of the mark.
import { format } from 'date-fns';
import { AlarmClock, Clock, HelpCircle, History } from 'lucide-react';
import { useState } from 'react';
import { db } from '../data/db';
import { atLocal, newId, todayISO } from '../domain/dates';
import { completedLate } from '../domain/adherence';
import type { DayEntry } from '../domain/types';
import { t } from '../i18n/uk';
import { Sheet, SheetButton } from './Sheet';
import { saved } from './Toast';

const L = t.mark;

/** The confirmed real time, or none («не пам'ятаю»). */
export type ConfirmedWhen = { time: string } | { unknown: true };
export type When = ConfirmedWhen | { uncertain: true };
export interface MedMark { key: string; title: string; prescriptionId?: string }

const nowAt = () => atLocal(todayISO(), format(new Date(), 'HH:mm'));
const marks = (when: When) => ({ markedAt: nowAt(), ...('unknown' in when ? { timeUnknown: true as const } : {}) });
const say = (title: string, status: 'done' | 'skipped', when?: When) =>
  status === 'skipped' ? t.toast.skipped(title) : t.toast.marked(title, when && 'time' in when ? when.time : undefined);

/** Medicines of one planned time: taken (when) or skipped; a skipped dose has no real time, it keeps the planned one. */
export function markMeds(meds: MedMark[], date: string, planned: string | undefined, status: 'done' | 'skipped', when: When) {
  const uncertain = 'uncertain' in when;
  const time = 'time' in when ? when.time : planned ?? '12:00';
  const title = meds.map((m) => m.title).join(', ');
  let previous: DayEntry[] = [];
  let created: string[] = [];
  const write = async () => {
    const dayEntries = await db.entries.where('at').startsWith(`${date}T`).toArray();
    previous = meds.map((m) => dayEntries.find((e) => e.checkKey === m.key)).filter((e): e is DayEntry => !!e);
    const previousByKey = new Map(previous.map((e) => [e.checkKey, e]));
    const rows = meds.map((m): DayEntry => ({
      id: previousByKey.get(m.key)?.id ?? newId(),
      at: atLocal(date, time),
      kind: 'med',
      status: uncertain ? 'planned' : status,
      ...(uncertain ? { adherence: 'uncertain' as const, markedAt: nowAt() }
        : status === 'done' && completedLate(time, planned) ? { adherence: 'completed_late' as const, ...marks(when) }
          : marks(when)),
      title: m.title,
      checkKey: m.key,
      ...(m.prescriptionId ? { prescriptionId: m.prescriptionId } : {}),
    }));
    const oldIds = new Set(previous.map((e) => e.id));
    created = rows.filter((e) => !oldIds.has(e.id)).map((e) => e.id);
    await db.entries.bulkPut(rows);
  };
  return saved(write(), uncertain ? t.toast.uncertainSaved(title) : say(title, status, when), async () => {
    await db.entries.bulkDelete(created);
    await db.entries.bulkPut(previous);
  });
}

/** A planned meal: eaten (when) or skipped; the plan's time is kept as `plannedAt` when the real one differs.
 *  `patch` — what was really eaten (D55: the lines ticked in «Підтвердити прийом»); «Скасувати» brings the plan back. */
export function markMeal(e: DayEntry, date: string, status: 'done' | 'skipped', when: ConfirmedWhen, patch: Partial<DayEntry> = {}) {
  const at = 'time' in when ? atLocal(date, when.time) : e.at;
  const next: DayEntry = { ...e, ...patch, status, at, ...(at !== e.at ? { plannedAt: e.plannedAt ?? e.at } : {}), ...marks(when) };
  delete next.adherence;
  return saved(db.entries.put(next), say(e.title, status, when), () => db.entries.put(e));
}

/** «Коли?» — the choice before a late mark. `planned` is the plan's time; «Щойно» only for today. */
export function TimeChoice({ title, planned, date, meal, allowUncertain, onPick, onClose }: {
  title: string; planned?: string; date: string; meal?: boolean; allowUncertain?: boolean; onPick: (when: When) => void; onClose: () => void;
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
      {allowUncertain && <SheetButton onClick={() => pick({ uncertain: true })}><HelpCircle size={20} />{L.uncertain}</SheetButton>}
      <SheetButton onClick={() => pick({ unknown: true })}><HelpCircle size={20} />{L.unknown}</SheetButton>
    </Sheet>
  );
}
