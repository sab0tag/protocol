import { format } from 'date-fns';
import { saved } from './Toast';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Pill, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { atLocal, newId } from '../domain/dates';
import { amountText } from '../domain/foodSearch';
import { dayFocus, type NowItem } from '../domain/reminders';
import type { DayEntry, Plan } from '../domain/types';
import { t } from '../i18n/uk';
import { localSnoozed, snooze } from '../sync/push';

const L = t.now;
const SNOOZE_MIN = 15;
const label = 'text-sm font-semibold uppercase tracking-wider text-muted';

/** «Зараз» (SPEC.md D35) in three states (D50): «Зараз» — what is due now, the one strong card on the screen;
 *  «Не відмічено» — past items without a mark, a quiet list asking what happened, never «take it now»;
 *  «Далі» — the next item, when nothing is due. A reminder opens to this. */
export function NowCard({ entries, plan, date }: { entries: DayEntry[]; plan: Plan | undefined; date: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);
  const synced = useLiveQuery(async () => (await db.meta.get('sync'))?.snoozed ?? {}, [], undefined);
  if (synced === undefined) return null;
  const focus = dayFocus({ entries, plan, date, now, snoozed: { ...localSnoozed, ...synced } });
  if (!focus.now && !focus.next && !focus.missed.length) return null;
  return (
    <div className="mb-3 space-y-3">
      {focus.now && <Due item={focus.now} date={date} onSnoozed={() => setNow(new Date())} />}
      {focus.next && (
        <section aria-label={L.next} className="flex min-h-tap items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2">
          <span className={label}>{L.next}</span>
          <span className="tabular text-muted">{focus.next.time}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{titleOf(focus.next)}</span>
        </section>
      )}
      {focus.missed.length > 0 && (
        <section aria-label={L.missed} className="rounded-2xl border border-line bg-surface">
          <h2 className={`${label} px-3 pt-2`}>{L.missed}</h2>
          <ul className="divide-y divide-line">
            {focus.missed.map((x) => (
              <li key={x.key} className="grid grid-cols-[3rem_1fr] items-center gap-x-2 px-3 py-1 sm:grid-cols-[3rem_1fr_auto]">
                <span className="tabular text-muted">{x.time}</span>
                <span className="min-w-0 font-medium">{titleOf(x)}</span>
                <span className="col-start-2 flex gap-1 sm:col-start-3">
                  <button type="button" onClick={() => void mark(x, date, 'done', x.time)}
                    className="min-h-tap rounded-xl border border-line px-3 text-sm font-medium">{x.entry ? L.eatenThen : L.takenThen}</button>
                  <button type="button" onClick={() => void mark(x, date, 'skipped', x.time)}
                    className="min-h-tap rounded-xl px-2 text-sm text-muted">{L.skipped}</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Due({ item, date, onSnoozed }: { item: NowItem; date: string; onSnoozed: () => void }) {
  const Icon = item.entry ? UtensilsCrossed : Pill;
  const detail = item.entry ? item.entry.items?.map((x) => `${x.name} ${amountText(x)}`).join(', ')
    : item.meds?.some((m) => m.withFood) ? L.withFood : undefined;
  const later = () => saved(snooze(item.key, Date.now() + SNOOZE_MIN * 60_000), t.toast.later(SNOOZE_MIN)).then(onSnoozed);
  return (
    <section aria-label={L.title} className="rounded-2xl border border-line bg-surface p-4 shadow-md shadow-ink/5">
      <p className="flex items-center justify-between">
        <span className={`${label} flex items-center gap-2 text-ink`}><span className="h-2 w-2 rounded-full bg-accent" aria-hidden />{L.title}</span>
        <span className="tabular text-muted">{item.time}</span>
      </p>
      <p className="mt-2 flex items-start gap-2 text-2xl font-semibold leading-tight"><Icon size={24} className="mt-0.5 shrink-0 text-accent" aria-hidden />{titleOf(item)}</p>
      {detail && <p className="mt-1 text-muted first-letter:uppercase">{detail}</p>}
      <button type="button" onClick={() => void mark(item, date, 'done', format(new Date(), 'HH:mm'))}
        className="mt-4 flex min-h-tap w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-lg font-semibold text-surface">
        <Check size={22} aria-hidden />{item.entry ? L.eaten : L.taken}</button>
      <div className="mt-1 flex justify-center gap-4">
        <button type="button" onClick={() => void later()} className="min-h-tap px-2 text-muted">{L.later(SNOOZE_MIN)}</button>
        {item.entry && <button type="button" onClick={() => void mark(item, date, 'skipped', item.time)} className="min-h-tap px-2 text-muted">{L.skip}</button>}
      </div>
    </section>
  );
}

const titleOf = (x: NowItem) => x.entry?.title ?? x.meds?.map((m) => m.title).join(', ') ?? x.title;

/** A meal keeps its planned time; medicines are marked at `time` — now for «Прийнято», the planned time for «Прийнято тоді». */
function mark(x: NowItem, date: string, status: 'done' | 'skipped', time: string) {
  const say = status === 'done' ? (x.entry ? t.toast.done : t.toast.med) : t.toast.skipped;
  const e = x.entry;
  if (e) return saved(db.entries.put({ ...e, status }), say(e.title), () => db.entries.put(e));
  const meds = x.meds ?? [];
  const ids = meds.map(() => newId());
  return saved(db.entries.bulkAdd(meds.map((m, i) => ({ id: ids[i]!, at: atLocal(date, time), kind: 'med' as const, status,
    title: m.title, checkKey: m.key, prescriptionId: m.prescriptionId }))), say(titleOf(x)), () => db.entries.bulkDelete(ids));
}
