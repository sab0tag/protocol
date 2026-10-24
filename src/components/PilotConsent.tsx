// D119: «Допомогти пілоту» — the consent with the person's own numbers of last week, counted by the same function that sends
// them; no box ticked beforehand, two buttons of equal weight. `SummaryView` shows a week as it goes — here and in «Ще → Пілот».
import { useEffect, useState } from 'react';
import { inDemo } from '../data/db';
import type { Summary } from '../domain/pilot';
import { todayISO } from '../domain/dates';
import { decline, firstDayOfUse, giveConsent, lastWeek, offerDue, pilotMeta, summaryFor } from '../sync/pilot';
import { t } from '../i18n/uk';

const L = t.pilot;

export function summaryHead(s: Summary): string[] {
  return [L.head.meds(s.meds.done, s.meds.due), L.head.food(s.food.days_logged), L.head.ways(s.food.by_voice, s.food.by_text, s.food.by_photo), L.head.days(s.days_in)];
}
/** Every field of the summary, in words — nothing goes that is not on this list. */
export function summaryAll(s: Summary): string[] {
  return [
    L.all.week(s.week), L.all.active(s.active_days),
    L.all.meds(s.meds.skipped, s.meds.late_30, s.meds.prn_taken),
    L.all.food(s.food.entries, s.food.not_found),
    L.all.plan(s.plan.meds, s.plan.constraints),
    L.all.photo(s.plan.from_photo, s.plan.photo_rows, s.plan.photo_rows_edited),
    L.all.help(s.help.why_opened, s.help.topup_shown, s.help.topup_taken, s.help.danger_card),
    ...(s.rem ? [L.all.rem(s.rem.sent, s.rem.acked)] : []),
    L.all.other(s.other.water_days, s.other.workouts, s.other.wellbeing_days, s.other.report_made),
    ...(s.src ? [L.all.src(s.src)] : []),
    L.all.app(s.app.build, s.app.platform), L.all.id,
  ];
}

export function SummaryView({ s }: { s: Summary }) {
  return (
    <div className="text-sm">
      <ul className="list-disc space-y-0.5 pl-5" data-testid="pilot-head">{summaryHead(s).map((x) => <li key={x}>{x}</li>)}</ul>
      <details className="mt-1">
        <summary className="min-h-tap cursor-pointer text-accent underline">{L.sampleAll}</summary>
        <ul className="list-disc space-y-0.5 pl-5 text-muted" data-testid="pilot-all">{summaryAll(s).map((x) => <li key={x}>{x}</li>)}</ul>
      </details>
    </div>
  );
}

export function PilotConsent({ onDone, className = '' }: { onDone?: (yes: boolean) => void; className?: string }) {
  const [sample, setSample] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void pilotMeta().then((m) => summaryFor(lastWeek(), m.pid ?? 'p_', m.src)).then((s) => { if (live) setSample(s); });
    return () => { live = false; };
  }, []);
  if (inDemo()) return null; // D98: the example sends nothing and asks nothing
  const answer = async (yes: boolean) => {
    setBusy(true);
    await (yes ? giveConsent() : decline());
    onDone?.(yes);
  };
  const btn = 'min-h-tap flex-1 rounded-xl border border-accent px-3 font-medium text-accent disabled:opacity-40';
  return (
    <section aria-label={L.ask} className={`space-y-2 rounded-2xl border border-accent/40 bg-surface p-3 ${className}`}>
      <h2 className="font-semibold">{L.ask}</h2>
      <p className="text-sm">{L.lead}</p>
      <p className="text-sm">{L.sample}</p>
      {sample ? <SummaryView s={sample} /> : <p className="text-sm text-muted">…</p>}
      <p className="text-sm text-muted">{L.canStop}</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy || !sample} onClick={() => void answer(true)} className={btn}>{L.yes}</button>
        <button type="button" disabled={busy} onClick={() => void answer(false)} className={btn}>{L.no}</button>
      </div>
    </section>
  );
}

/** D119: the offer on «День» — from the 3rd day of use, without a code given in onboarding too; after «Ні» not before 30 days,
 *  twice at most; never in the example. */
export function PilotOffer() {
  const [due, setDue] = useState(false);
  useEffect(() => {
    if (inDemo()) return;
    let live = true;
    void Promise.all([pilotMeta(), firstDayOfUse()]).then(([m, first]) => { if (live) setDue(offerDue(m, first, todayISO())); });
    return () => { live = false; };
  }, []);
  return due ? <PilotConsent className="mb-3" onDone={() => setDue(false)} /> : null;
}
