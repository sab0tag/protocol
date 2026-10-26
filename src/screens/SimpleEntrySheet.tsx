import { format } from 'date-fns';
import { saved } from '../components/Toast';
import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { db } from '../data/db';
import { atLocal, newId, timeOf, todayISO } from '../domain/dates';
import type { DayEntry, EntryKind } from '../domain/types';
import { t } from '../i18n/uk';

/** Medicine, water, workout or note: a title (or millilitres) and a time. Rich forms come in M3. */
export function SimpleEntrySheet({ kind, entry, date, onClose }: {
  kind: Exclude<EntryKind, 'meal' | 'symptom'>; entry?: DayEntry; date: string; onClose: () => void;
}) {
  const [title, setTitle] = useState(entry?.title ?? (kind === 'water' ? t.addKinds.water : ''));
  const [ml, setMl] = useState(String(entry?.waterMl ?? 250));
  const [time, setTime] = useState(entry ? timeOf(entry.at) : date === todayISO() ? format(new Date(), 'HH:mm') : '12:00');
  const [done, setDone] = useState(entry ? entry.status === 'done' : date <= todayISO());

  const save = async () => {
    const waterMl = kind === 'water' ? Math.max(0, Math.round(Number(ml) || 0)) : undefined;
    // the rest of the row (a medicine's checkKey, D52 marks) stays; an unknown time stays unknown until it is changed
    const { timeUnknown: _unknown, ...rest } = entry ?? {};
    const row: DayEntry = {
      ...rest, id: entry?.id ?? newId(), at: atLocal(date, time), kind, title: title.trim() || t.addKinds[kind],
      status: entry?.status === 'skipped' && !done ? 'skipped' : done ? 'done' : 'planned',
      ...(waterMl !== undefined ? { waterMl } : {}),
      ...(entry?.timeUnknown && time === timeOf(entry.at) ? { timeUnknown: true as const } : {}),
    };
    onClose();
    await saved(db.entries.put(row), kind === 'water' && row.waterMl ? t.toast.water(row.waterMl)
      : kind === 'med' && row.status === 'done' ? t.toast.med(row.title) : t.toast.entry(row.title));
  };

  return (
    <Sheet title={t.simple[kind]} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {kind === 'water' ? (
          <label className="block">
            <span className="text-sm text-muted">{t.simple.water}</span>
            <input type="number" inputMode="numeric" min={0} step={50} value={ml} onChange={(e) => setMl(e.target.value)}
              className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" />
          </label>
        ) : (
          <label className="block">
            <span className="text-sm text-muted">{t.simple.title}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required
              className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" />
          </label>
        )}
        <label className="block">
          <span className="text-sm text-muted">{t.simple.time}</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required
            className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" />
          {entry?.timeUnknown && time === timeOf(entry.at) && <span className="mt-1 block text-sm text-muted">{t.simple.timeUnknown}</span>}
        </label>
        <label className="protocol-toggle-row min-h-tap">
          <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} className="protocol-switch" />
          <span>{t.status.done}</span>
        </label>
        <div className="flex gap-2 pt-1">
          <button type="submit" className="min-h-tap flex-1 rounded-xl bg-accent px-4 font-medium text-surface">{t.simple.save}</button>
          <button type="button" onClick={onClose} className="min-h-tap rounded-xl border border-line px-4">{t.simple.cancel}</button>
        </div>
      </form>
    </Sheet>
  );
}
