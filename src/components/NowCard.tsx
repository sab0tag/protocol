import { useFeatures } from '../app/features';
import { entryVisible } from '../domain/visibility';
import { addDays, format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';
import { saved } from './Toast';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronDown, MoreHorizontal, Pill, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { todayISO } from '../domain/dates';
import { amountText } from '../domain/foodSearch';
import { dayFocus, type NowItem, type NowMed } from '../domain/reminders';
import type { DayEntry, Plan } from '../domain/types';
import { t } from '../i18n/uk';
import { localSnoozed, snooze } from '../sync/push';
import { markMeal, markMeds, SkipChoice, TimeChoice, type ConfirmedWhen } from './MarkTime';
import type { Observation } from '../domain/observation';

const L = t.now;
const SNOOZE_MIN = 15;
const label = 'text-sm font-semibold uppercase tracking-wider text-muted';

/** «Зараз» (SPEC.md D35) in three states (D50): «Зараз» — what is due now, the one strong card on the screen;
 *  «Не відмічено» — past items without a mark, folded into one line, asking what happened — never «take it now»;
 *  «Далі» — the next item, when nothing is due. A reminder opens to this. An earlier day shows only its own
 *  «Не відмічено» (D52) — today's screen never collects yesterday's. */
export function NowCard({ entries, plan, date, observation, onConfirm, onReschedule, compact = false }: { entries: DayEntry[]; plan: Plan | undefined; date: string; observation?: Observation; compact?: boolean; onConfirm: (e: DayEntry) => void; onReschedule: (e: DayEntry) => void }) {
  const { can, context } = useFeatures();
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setClock(new Date()), 30_000); return () => clearInterval(id); }, []);
  const synced = useLiveQuery(async () => (await db.meta.get('sync'))?.snoozed ?? {}, [], undefined);
  const today = todayISO();
  if (synced === undefined || date > today) return null;
  const now = date === today ? clock : new Date(`${date}T23:59:00`);
  const focus = dayFocus({ entries: entries.filter((e) => entryVisible(e, context)), plan: plan && !can('meds.log') ? { ...plan, prescriptions: [] } : plan, date, now, observation, snoozed: { ...localSnoozed, ...synced } });
  if (!focus.now && !focus.next && !focus.missed.length) return null;
  return (
    <div className="mb-3 space-y-3">
      {focus.now && <Due item={focus.now} date={date} onSnoozed={() => setClock(new Date())} onConfirm={onConfirm} onReschedule={onReschedule} />}
      {focus.next && (!compact || !focus.now) && (
        <section aria-label={L.next} className="flex min-h-tap items-center gap-3 protocol-card px-4 py-3">
          <span className={label}>{L.next}</span>
          <span className="tabular text-muted">{focus.next.time}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{titleOf(focus.next)}</span>
        </section>
      )}
      {focus.missed.length > 0 && <Missed items={focus.missed} date={date} onConfirm={onConfirm} onReschedule={onReschedule} />}
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

function Due({ item, date, onSnoozed, onConfirm, onReschedule }: { item: NowItem; date: string; onSnoozed: () => void; onConfirm: (e: DayEntry) => void; onReschedule: (e: DayEntry) => void }) {
  const Icon = item.entry ? UtensilsCrossed : Pill;
  const meds = item.meds;
  const overdue = item.late > 60;
  const [askingWhen, setAskingWhen] = useState(false);
  const [askingSkip, setAskingSkip] = useState(false);
  const detail = item.entry ? item.entry.items?.map((x) => `${x.name} ${amountText(x)}`).join(', ')
    : foodNote(meds ?? []);
  const today = todayISO(), day = date === today ? L.today : date === format(addDays(parseISO(today), -1), 'yyyy-MM-dd') ? L.yesterday
    : format(parseISO(date), 'd MMMM', { locale: uk });
  const when = item.late < 0 && item.late >= -60 ? L.inMin(-item.late, item.time) : item.late !== 0 ? L.ago(day, item.time) : L.at(item.time);
  const later = () => saved(snooze(item.key, Date.now() + SNOOZE_MIN * 60_000), t.toast.later(SNOOZE_MIN)).then(onSnoozed);
  const nowHm = () => ({ time: format(new Date(), 'HH:mm') });
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const act = (f: () => void) => () => { setMenu(false); f(); };
  // ТЗ 17.11, step 3: compact — what to take with the doctor's word in one line, one «Прийнято», the rest behind «⋯»
  return (
    <section aria-label={L.title} className="protocol-card protocol-now-card border-warn/30 bg-warn-bg/30 px-4 pb-4 pt-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <span className={`${label} flex items-center gap-2 text-ink`}><span className="h-2 w-2 rounded-full bg-accent" aria-hidden />{L.title}</span>
          <span className="tabular truncate text-muted">{when}</span>
        </p>
        <button type="button" aria-label={L.more} aria-expanded={menu} aria-controls="now-menu" onClick={() => setMenu((v) => !v)}
          onKeyDown={(e) => { if (e.key === 'Escape') setMenu(false); }}
          className="-mr-2 flex min-h-tap min-w-tap items-center justify-center rounded-full text-muted"><MoreHorizontal size={22} aria-hidden /></button>
      </div>
      <p className="flex items-start gap-2 text-lg font-semibold leading-snug"><Icon size={20} className="mt-1 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0">{titleOf(item)}{detail && <span className="font-normal text-muted"> · <span className="first-letter:uppercase">{detail}</span></span>}</span></p>
      {menu && <div id="now-menu" role="group" aria-label={L.more} className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={act(() => void later())} className="min-h-tap rounded-full border-2 border-line bg-surface px-3 text-sm font-semibold">{L.later(SNOOZE_MIN)}</button>
        <button type="button" onClick={act(() => setAskingSkip(true))} className="min-h-tap rounded-full border-2 border-line bg-surface px-3 text-sm font-semibold">{L.skip}</button>
        {item.entry && <button type="button" onClick={act(() => onReschedule(item.entry!))} className="min-h-tap rounded-full border-2 border-line bg-surface px-3 text-sm font-semibold">{t.reschedule.action}</button>}
        {meds && <button type="button" onClick={act(() => void markMeds(meds, date, item.time, 'done', { uncertain: true }))}
          className="min-h-tap rounded-full border-2 border-line bg-surface px-3 text-sm font-semibold">{t.mark.uncertain}</button>}
        {overdue && !item.entry && <button type="button" aria-expanded={help} onClick={act(() => setHelp((v) => !v))} className="min-h-tap rounded-full border-2 border-line bg-surface px-3 text-sm font-semibold">{L.whatToDo}</button>}
      </div>}
      {help && <p className="mt-2 text-sm text-muted">{L.missedHelp}</p>}
      <button type="button" onClick={() => (overdue && !item.entry ? setAskingWhen(true) : item.entry?.items?.length ? onConfirm(item.entry) : void mark(item, date, 'done', nowHm()))}
        className="mt-3 flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-full bg-accent px-4 text-lg font-semibold text-on-accent">
        <Check size={22} aria-hidden />{item.entry ? L.eaten : L.taken}</button>
      {askingWhen && <TimeChoice title={titleOf(item)} planned={item.time} date={date} meal={false} allowUncertain onPick={(when) => { if ('uncertain' in when) void markMeds(meds ?? [], date, item.time, 'done', when); else void mark(item, date, 'done', when); setAskingWhen(false); }} onClose={() => setAskingWhen(false)} />}
      {askingSkip && <SkipChoice title={titleOf(item)} onClose={() => setAskingSkip(false)} onConfirm={(reason) => void mark(item, date, 'skipped', { time: item.time }, reason)} />}
    </section>
  );
}

/** Folded to «Не відмічено · 3» — after a heavy day the list must not take the screen. */
function Missed({ items, date, onConfirm, onReschedule }: { items: NowItem[]; date: string; onConfirm: (e: DayEntry) => void; onReschedule: (e: DayEntry) => void }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<NowItem | null>(null);
  const [skipping, setSkipping] = useState<NowItem | null>(null);
  return (
    <section aria-label={L.missed} className="protocol-card">
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
              <span className="col-start-2 flex flex-wrap gap-1 sm:col-start-3">
                <button type="button" onClick={() => (x.entry?.items?.length ? onConfirm(x.entry) : setAsking(x))} className="min-h-tap rounded-xl border border-line px-3 text-sm font-medium">{L.mark}</button>
                <button type="button" onClick={() => setSkipping(x)} className="min-h-tap rounded-xl px-2 text-sm text-muted">{L.skipped}</button>
                {x.entry && <button type="button" onClick={() => onReschedule(x.entry!)} className="min-h-tap rounded-xl px-2 text-sm text-muted">{t.reschedule.action}</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {skipping && <SkipChoice title={titleOf(skipping)} onClose={() => setSkipping(null)} onConfirm={(reason) => void mark(skipping, date, 'skipped', { time: skipping.time }, reason)} />}
      {asking && <TimeChoice title={titleOf(asking)} planned={asking.time} date={date} meal={!!asking.entry} allowUncertain={!asking.entry}
        onPick={(when) => {
          if ('uncertain' in when) {
            if (!asking.entry) void markMeds(asking.meds ?? [], date, asking.time, 'done', when);
          } else void mark(asking, date, 'done', when);
        }} onClose={() => setAsking(null)} />}
    </section>
  );
}

const titleOf = (x: NowItem) => x.entry?.title ?? x.meds?.map((m) => m.title).join(', ') ?? x.title;

function mark(x: NowItem, date: string, status: 'done' | 'skipped', when: ConfirmedWhen, reason?: string) {
  return x.entry ? markMeal(x.entry, date, status, when, {}, reason) : markMeds(x.meds ?? [], date, x.time, status, when, reason);
}
