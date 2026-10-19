import { format } from 'date-fns';
import { saved } from './Toast';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronDown, Pill, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { todayISO } from '../domain/dates';
import { amountText } from '../domain/foodSearch';
import { dayFocus, type NowItem, type NowMed } from '../domain/reminders';
import type { DayEntry, Plan } from '../domain/types';
import { t } from '../i18n/uk';
import { localSnoozed, snooze } from '../sync/push';
import { markMeal, markMeds, TimeChoice, type When } from './MarkTime';

const L = t.now;
const SNOOZE_MIN = 15;
const label = 'text-sm font-semibold uppercase tracking-wider text-muted';

/** «Зараз» (SPEC.md D35) in three states (D50): «Зараз» — what is due now, the one strong card on the screen;
 *  «Не відмічено» — past items without a mark, folded into one line, asking what happened — never «take it now»;
 *  «Далі» — the next item, when nothing is due. A reminder opens to this. An earlier day shows only its own
 *  «Не відмічено» (D52) — today's screen never collects yesterday's. */
export function NowCard({ entries, plan, date, onConfirm }: { entries: DayEntry[]; plan: Plan | undefined; date: string; onConfirm: (e: DayEntry) => void }) {
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setClock(new Date()), 30_000); return () => clearInterval(id); }, []);
  const synced = useLiveQuery(async () => (await db.meta.get('sync'))?.snoozed ?? {}, [], undefined);
  const today = todayISO();
  if (synced === undefined || date > today) return null;
  const now = date === today ? clock : new Date(`${date}T23:59:00`);
  const focus = dayFocus({ entries, plan, date, now, snoozed: { ...localSnoozed, ...synced } });
  if (!focus.now && !focus.next && !focus.missed.length) return null;
  return (
    <div className="mb-3 space-y-3">
      {focus.now && <Due item={focus.now} date={date} onSnoozed={() => setClock(new Date())} onConfirm={onConfirm} />}
      {focus.next && (
        <section aria-label={L.next} className="flex min-h-tap items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2">
          <span className={label}>{L.next}</span>
          <span className="tabular text-muted">{focus.next.time}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{titleOf(focus.next)}</span>
        </section>
      )}
      {focus.missed.length > 0 && <Missed items={focus.missed} date={date} onConfirm={onConfirm} />}
    </div>
  );
}

/** «під час їжі» / «натщесерце» for the doses due now — one word when they agree, else per medicine (D103: an empty
 *  stomach is what matters for some, and it was lost after the plan was made). */
function foodNote(meds: NowMed[]): string | undefined {
  const said = meds.filter((m) => m.withFood != null);
  if (!said.length) return undefined;
  const word = (m: NowMed) => (m.withFood ? L.withFood : L.empty);
  return said.length === meds.length && said.every((m) => m.withFood === said[0]!.withFood) ? word(said[0]!) : said.map((m) => `${m.title} — ${word(m)}`).join('; ');
}

function Due({ item, date, onSnoozed, onConfirm }: { item: NowItem; date: string; onSnoozed: () => void; onConfirm: (e: DayEntry) => void }) {
  const Icon = item.entry ? UtensilsCrossed : Pill;
  const detail = item.entry ? item.entry.items?.map((x) => `${x.name} ${amountText(x)}`).join(', ')
    : foodNote(item.meds ?? []);
  const when = item.late < 0 ? L.inMin(-item.late, item.time) : item.late > 0 ? L.ago(item.late, item.time) : L.at(item.time);
  const later = () => saved(snooze(item.key, Date.now() + SNOOZE_MIN * 60_000), t.toast.later(SNOOZE_MIN)).then(onSnoozed);
  const nowHm = () => ({ time: format(new Date(), 'HH:mm') });
  return (
    <section aria-label={L.title} className="rounded-2xl border border-line bg-surface p-4 shadow-md shadow-ink/5">
      <p className="flex items-center justify-between gap-2">
        <span className={`${label} flex items-center gap-2 text-ink`}><span className="h-2 w-2 rounded-full bg-accent" aria-hidden />{L.title}</span>
        <span className="tabular text-right text-muted">{when}</span>
      </p>
      <p className="mt-2 flex items-start gap-2 text-2xl font-semibold leading-tight"><Icon size={24} className="mt-0.5 shrink-0 text-accent" aria-hidden />{titleOf(item)}</p>
      {detail && <p className="mt-1 text-muted first-letter:uppercase">{detail}</p>}
      <button type="button" onClick={() => (item.entry?.items?.length ? onConfirm(item.entry) : void mark(item, date, 'done', nowHm()))}
        className="mt-4 flex min-h-tap w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-lg font-semibold text-surface">
        <Check size={22} aria-hidden />{item.entry ? L.eaten : L.taken}</button>
      <div className="mt-1 flex justify-center gap-4">
        <button type="button" onClick={() => void later()} className="min-h-tap px-2 text-muted">{L.later(SNOOZE_MIN)}</button>
        {item.entry && <button type="button" onClick={() => void mark(item, date, 'skipped', { time: item.time })} className="min-h-tap px-2 text-muted">{L.skip}</button>}
      </div>
    </section>
  );
}

/** Folded to «Не відмічено · 3» — after a heavy day the list must not take the screen. */
function Missed({ items, date, onConfirm }: { items: NowItem[]; date: string; onConfirm: (e: DayEntry) => void }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<NowItem | null>(null);
  return (
    <section aria-label={L.missed} className="rounded-2xl border border-line bg-surface">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex min-h-tap w-full items-center justify-between gap-2 px-3 text-left">
        <span className={label}>{L.missedCount(items.length)}</span>
        <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <ul className="divide-y divide-line border-t border-line">
          {items.map((x) => (
            <li key={x.key} className="grid grid-cols-[3rem_1fr] items-center gap-x-2 px-3 py-1 sm:grid-cols-[3rem_1fr_auto]">
              <span className="tabular text-muted">{x.time}</span>
              <span className="min-w-0 font-medium">{titleOf(x)}</span>
              <span className="col-start-2 flex gap-1 sm:col-start-3">
                <button type="button" onClick={() => (x.entry?.items?.length ? onConfirm(x.entry) : setAsking(x))} className="min-h-tap rounded-xl border border-line px-3 text-sm font-medium">{L.mark}</button>
                <button type="button" onClick={() => void mark(x, date, 'skipped', { time: x.time })} className="min-h-tap rounded-xl px-2 text-sm text-muted">{L.skipped}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {asking && <TimeChoice title={titleOf(asking)} planned={asking.time} date={date} meal={!!asking.entry}
        onPick={(when) => void mark(asking, date, 'done', when)} onClose={() => setAsking(null)} />}
    </section>
  );
}

const titleOf = (x: NowItem) => x.entry?.title ?? x.meds?.map((m) => m.title).join(', ') ?? x.title;

function mark(x: NowItem, date: string, status: 'done' | 'skipped', when: When) {
  return x.entry ? markMeal(x.entry, date, status, when) : markMeds(x.meds ?? [], date, x.time, status, when);
}
