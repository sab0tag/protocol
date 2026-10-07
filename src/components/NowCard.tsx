import { format } from 'date-fns';
import { saved } from './Toast';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlarmClock, Check, Pill, UtensilsCrossed, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { atLocal, newId } from '../domain/dates';
import { amountText } from '../domain/foodSearch';
import { nowItem } from '../domain/reminders';
import type { DayEntry, Plan } from '../domain/types';
import { t } from '../i18n/uk';
import { localSnoozed, snooze } from '../sync/push';

const L = t.now;
const SNOOZE_MIN = 15;

/** «Зараз» (SPEC.md D35): the one thing to do now, with «Виконано» and «Пізніше 15 хв» — what a reminder opens to. */
export function NowCard({ entries, plan, date }: { entries: DayEntry[]; plan: Plan | undefined; date: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);
  const synced = useLiveQuery(async () => (await db.meta.get('sync'))?.snoozed ?? {}, [], undefined);
  if (synced === undefined) return null;
  const item = nowItem({ entries, plan, date, now, snoozed: { ...localSnoozed, ...synced } });
  if (!item) return null;

  const done = async () => {
    const e = item.entry;
    if (e) { await saved(db.entries.put({ ...e, status: 'done' }), t.toast.done(e.title), () => db.entries.put(e)); return; }
    const ids = (item.meds ?? []).map(() => newId());
    await saved(db.entries.bulkAdd((item.meds ?? []).map((m, i) => ({ id: ids[i]!, at: atLocal(date, format(new Date(), 'HH:mm')), kind: 'med' as const,
      status: 'done' as const, title: m.title, checkKey: m.key, prescriptionId: m.prescriptionId }))),
    t.toast.med((item.meds ?? []).map((m) => m.title).join(', ')), () => db.entries.bulkDelete(ids));
  };
  const later = () => saved(snooze(item.key, Date.now() + SNOOZE_MIN * 60_000), t.toast.later(SNOOZE_MIN)).then(() => setNow(new Date()));
  const skip = async () => { const e = item.entry; if (e) await saved(db.entries.put({ ...e, status: 'skipped' }), t.toast.skipped(e.title), () => db.entries.put(e)); };
  const Icon = item.kind === 'meal' ? UtensilsCrossed : Pill;
  const detail = item.entry?.items?.map((x) => `${x.name} ${amountText(x)}`).join(', ') ?? item.meds?.map((m) => m.title).join(', ');

  return (
    <section aria-label={L.title} className={`mb-3 rounded-2xl border-2 p-3 ${item.overdue ? 'border-accent bg-accent/10' : 'border-line bg-surface'}`}>
      <p className="text-sm font-medium text-muted">{item.overdue ? L.now : L.next(item.time)}</p>
      <p className="flex items-center gap-2 text-xl font-semibold"><Icon size={22} className="text-accent" aria-hidden />{item.title}
        {item.overdue && <span className="text-base font-normal text-muted">· {item.time}</span>}</p>
      {detail && <p className="mt-1">{detail}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void done()}
          className="flex min-h-tap flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-lg font-semibold text-surface"><Check size={22} aria-hidden />{L.done}</button>
        <button type="button" onClick={() => void later()}
          className="flex min-h-tap items-center gap-2 rounded-xl border border-line bg-surface px-3 font-medium"><AlarmClock size={18} aria-hidden />{L.later(SNOOZE_MIN)}</button>
        {item.entry && item.overdue && (
          <button type="button" onClick={() => void skip()} aria-label={L.skip}
            className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line bg-surface px-3 text-muted"><X size={18} aria-hidden /></button>
        )}
      </div>
    </section>
  );
}
