// What the server can say about use (SPEC.md D119), by weeks and without an id in the output.
// `opsStats` — from what the server sees anyway (vaults, the weeks they came online, AI spend, pushes and reactions,
// device tokens, the concierge's outcomes): only people with sync are visible. `pilotStats` — the pilot's summary table
// from the weekly counts participants sent by consent; a source code is shown on its own only from 5 participants.
import { weekAdd, weekKey, weekMonday, weeksBetween, type Summary } from './pilot.ts';
import type { Store } from './store.ts';

const DAY = 86_400_000;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const weeksTo = (to: string, count: number): [string, ...string[]] => [to, ...Array.from({ length: count - 1 }, (_, i) => weekAdd(to, i - count + 1))]
  .sort() as [string, ...string[]];
/** The weeks of the days a daily counter covers. */
const counterWeeks = (store: Store, like: string, from: string, to: string) => {
  const by = new Map<string, number>();
  const rows = store.all<{ day: string; scope: string; n: number }>('SELECT day, scope, n FROM counters WHERE scope LIKE ? AND day >= ? AND day < ?',
    like, new Date(weekMonday(from)).toISOString().slice(0, 10), new Date(weekMonday(to) + 7 * DAY).toISOString().slice(0, 10));
  for (const r of rows) {
    const k = `${weekKey(new Date(`${r.day}T12:00:00Z`))}|${r.scope}`;
    by.set(k, (by.get(k) ?? 0) + r.n);
  }
  return (week: string, scope: string) => by.get(`${week}|${scope}`) ?? 0;
};

export interface OpsWeek {
  week: string; new_vaults: number; active: number; active_30: number; back_w1: number | null; back_w4: number | null;
  device_tokens: number; rem_sent: number; rem_acked: number; rem_acked_pct: number | null; rem_ack_min: number | null;
  concierge: number; concierge_accepted: number; concierge_edited: number; concierge_ignored: number;
}
export interface OpsMonth { month: string; kind: string; calls: number; usd: number; vaults: number; usd_per_vault: number }

export function opsStats(store: Store, now: Date, count = 12): { weeks: OpsWeek[]; months: OpsMonth[] } {
  const to = weekKey(now), weeks = weeksTo(to, count);
  const created = store.all<{ id: string; created: string }>('SELECT id, created FROM vaults').map((v) => ({ id: v.id, week: weekKey(new Date(v.created)) }));
  const seen = new Map<string, Set<string>>();
  for (const r of store.all<{ vault: string; week: string }>('SELECT vault, week FROM vault_weeks WHERE week >= ?', weekAdd(weeks[0], -4))) {
    (seen.get(r.week) ?? seen.set(r.week, new Set()).get(r.week)!).add(r.vault);
  }
  const at = (w: string) => seen.get(w) ?? new Set<string>();
  const counter = counterWeeks(store, 'stat:%', weeks[0], to);
  const tokens = store.all<{ created: number }>('SELECT created FROM device_tokens WHERE created >= ?', weekMonday(weeks[0]));
  const log = store.all<{ ts: number; outcome: string | null }>('SELECT ts, outcome FROM concierge_log WHERE ts >= ?', weekMonday(weeks[0]));
  const out = weeks.map((week): OpsWeek => {
    const cohort = created.filter((v) => v.week === week);
    const back = (n: number) => (weekAdd(week, n) > to ? null : pct(cohort.filter((v) => at(weekAdd(week, n)).has(v.id)).length, cohort.length));
    const month = new Set<string>();
    for (let i = 0; i < 4; i += 1) for (const v of at(weekAdd(week, -i))) month.add(v);
    const sent = counter(week, 'stat:rem_sent'), acked = counter(week, 'stat:rem_acked');
    const inWeek = log.filter((r) => weekKey(new Date(r.ts)) === week);
    return {
      week, new_vaults: cohort.length, active: at(week).size, active_30: month.size, back_w1: back(1), back_w4: back(4),
      device_tokens: tokens.filter((t) => weekKey(new Date(t.created)) === week).length,
      rem_sent: sent, rem_acked: acked, rem_acked_pct: pct(acked, sent), rem_ack_min: acked ? Math.round(counter(week, 'stat:rem_ack_min') / acked) : null,
      concierge: inWeek.length, concierge_accepted: inWeek.filter((r) => r.outcome === 'accepted').length,
      concierge_edited: inWeek.filter((r) => r.outcome === 'edited').length,
      concierge_ignored: inWeek.filter((r) => !r.outcome || r.outcome === 'ignored' || r.outcome === 'dismissed').length,
    };
  });
  const months = [...new Set([weeks[0], to].map((w) => new Date(weekMonday(w)).toISOString().slice(0, 7)).concat(now.toISOString().slice(0, 7)))].sort();
  const ai: OpsMonth[] = [];
  for (const month of months) {
    for (const r of store.all<{ kind: string; calls: number; usd_micro: number; vaults: number }>(
      'SELECT kind, SUM(calls) AS calls, SUM(usd_micro) AS usd_micro, COUNT(DISTINCT vault) AS vaults FROM usage WHERE month = ? GROUP BY kind ORDER BY kind', month)) {
      ai.push({ month, kind: r.kind, calls: r.calls, usd: Math.round(r.usd_micro / 10_000) / 100, vaults: r.vaults, usd_per_vault: Math.round(r.usd_micro / r.vaults / 10_000) / 100 });
    }
  }
  return { weeks: out, months: ai };
}

// ------------------------------------------------------------------------------------------------ the pilot
export interface PilotRow {
  group: string; week: string; participants: number; qr: number; consents: number; plan_entered: number;
  ret_w2: number | null; ret_w5: number | null; marked: number | null; marked_w1: number | null; marked_w4plus: number | null; partial_weeks: number;
  on_time: number | null; food_days: number | null; voice: number | null; nf_per_entry: number | null; photo_edited: number | null; photo_unchecked: number | null;
  helps_d7: number | null; helps_d30: number | null; nps: number | null; blockers: string;
}
export const MIN_GROUP = 5;

interface Member { pid: string; joined: string; src: string | null; weeks: Map<string, Summary>; d7?: Survey; d30?: Survey; d7week?: string; d30week?: string }
interface Survey { helps: number; blocker?: string; report?: string; nps?: number }

function pilotRow(group: string, week: string, [from, to]: [string, string], members: Member[], qr: number): PilotRow {
  const all = week === 'всього';
  const inWeek = (w: string) => (all ? w >= from && w <= to : w === week);
  const sums = members.flatMap((m) => [...m.weeks].filter(([w]) => inWeek(w)).map(([w, s]) => ({ m, w, s, idx: weeksBetween(m.joined, w) + 1 })));
  const ratio = (xs: typeof sums) => median(xs.filter((x) => x.s.meds.due > 0).map((x) => Math.min(1, x.s.meds.done / x.s.meds.due)));
  /** Retention at the k-th week of a participant (the week of consent is the 1st): active 3 days or more that week.
   *  For a week — those whose k-th week it is; for the whole range — those whose k-th week is in it. */
  const share = (k: number) => {
    const due = members.filter((m) => { const kw = weekAdd(m.joined, k - 1); return all ? kw >= from && kw <= to : kw === week; });
    return pct(due.filter((m) => (m.weeks.get(weekAdd(m.joined, k - 1))?.active_days ?? 0) >= 3).length, due.length);
  };
  const sum = (f: (s: Summary) => number) => sums.reduce((a, x) => a + f(x.s), 0);
  const d7 = members.filter((m) => m.d7 && inWeek(m.d7week!)).map((m) => m.d7!);
  const d30 = members.filter((m) => m.d30 && inWeek(m.d30week!)).map((m) => m.d30!);
  const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const nps = d30.filter((s) => s.nps !== undefined).map((s) => s.nps!);
  const blockers = new Map<string, number>();
  for (const s of d7) if (s.blocker) blockers.set(s.blocker, (blockers.get(s.blocker) ?? 0) + 1);
  const ratioPct = (x: number | null) => (x === null ? null : Math.round(x * 100));
  return {
    group, week, participants: new Set(sums.map((x) => x.m.pid)).size, qr,
    consents: members.filter((m) => inWeek(m.joined)).length,
    plan_entered: members.filter((m) => inWeek(m.joined) && [...m.weeks.values()].some((s) => s.plan.meds + s.plan.constraints > 0)).length,
    // R17: weekly retention — active 3+ days in the 2nd and the 5th calendar week after joining (not exact D7 / D30)
    ret_w2: share(2), ret_w5: share(5),
    // the share of due doses marked taken in the app (a mark, not a proof of taking), the median over participants
    marked: ratioPct(ratio(sums)), marked_w1: ratioPct(ratio(sums.filter((x) => x.idx === 1))), marked_w4plus: ratioPct(ratio(sums.filter((x) => x.idx >= 4))),
    partial_weeks: sums.filter((x) => x.s.days_in < 7).length, // a first week joined midway — fewer days than a full one
    on_time: pct(sum((s) => Math.max(0, s.meds.done - s.meds.late_30)), sum((s) => s.meds.done)),
    food_days: median(sums.map((x) => x.s.food.days_logged)), voice: pct(sum((s) => s.food.by_voice), sum((s) => s.food.entries)),
    nf_per_entry: pct(sum((s) => s.food.not_found), sum((s) => s.food.entries)), // parts not found per 100 meal records — not a share of searches
    // D122: of the rows read off the paper — corrected later in «План», and not put in at all (a bad reading must not look good)
    photo_edited: pct(sum((s) => s.plan.photo_rows_edited), sum((s) => s.plan.photo_rows)),
    photo_unchecked: pct(sum((s) => s.plan.photo_rows_unchecked), sum((s) => s.plan.photo_rows)),
    helps_d7: mean(d7.map((s) => s.helps)), helps_d30: mean(d30.map((s) => s.helps)),
    nps: nps.length ? Math.round(((nps.filter((x) => x >= 9).length - nps.filter((x) => x <= 6).length) / nps.length) * 100) : null,
    blockers: [...blockers].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(', '),
  };
}
export function pilotStats(store: Store, from: string, to: string): { rows: PilotRow[]; hidden: number } {
  const members = new Map<string, Member>();
  for (const m of store.all<{ pid: string; joined: string }>('SELECT pid, joined FROM pilot_members')) members.set(m.pid, { ...m, src: null, weeks: new Map() });
  for (const r of store.all<{ pid: string; week: string; kind: string; src: string | null; body: string }>('SELECT pid, week, kind, src, body FROM pilot_weeks ORDER BY week')) {
    const m = members.get(r.pid);
    if (!m) continue;
    const body = JSON.parse(r.body) as Summary & { q: Survey };
    if (r.kind === 'week') { m.weeks.set(r.week, body); if (r.src) m.src = r.src; }
    if (r.kind === 'd7') { m.d7 = body.q; m.d7week = r.week; }
    if (r.kind === 'd30') { m.d30 = body.q; m.d30week = r.week; }
  }
  const weeks = weeksTo(to, weeksBetween(from, to) + 1);
  const qr = counterWeeks(store, 'qr:%', from, to);
  const sources = store.all<{ code: string; label: string }>('SELECT code, label FROM pilot_sources ORDER BY code');
  const groups: { name: string; members: Member[]; qr: (w: string) => number }[] = [
    { name: 'всього', members: [...members.values()], qr: (w) => sources.reduce((a, s) => a + qr(w, `qr:${s.code}`), 0) },
  ];
  let hidden = 0;
  for (const s of sources) {
    const ms = [...members.values()].filter((m) => m.src === s.code);
    if (ms.length < MIN_GROUP) { hidden += 1; continue; } // fewer than 5: one row could be a patient the doctor remembers
    groups.push({ name: `${s.code} · ${s.label}`, members: ms, qr: (w) => qr(w, `qr:${s.code}`) });
  }
  const rows: PilotRow[] = [];
  for (const g of groups) {
    const inRange = g.members.filter((m) => m.joined <= to);
    for (const w of weeks) rows.push(pilotRow(g.name, w, [from, to], inRange, g.qr(w)));
    rows.push(pilotRow(g.name, 'всього', [from, to], inRange, weeks.reduce((a, w) => a + g.qr(w), 0)));
  }
  return { rows, hidden };
}

// ------------------------------------------------------------------------------------------------ output
export function table(rows: object[], format: 'md' | 'csv'): string {
  const [first] = rows;
  if (!first) return '';
  const keys = Object.keys(first);
  const cell = (v: unknown) => (v === null || v === undefined || v === '' ? (format === 'md' ? '—' : '') : String(v));
  if (format === 'csv') {
    const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    return [keys.join(','), ...rows.map((r) => keys.map((k) => q(cell((r as Record<string, unknown>)[k]))).join(','))].join('\n') + '\n';
  }
  return [`| ${keys.join(' | ')} |`, `|${keys.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${keys.map((k) => cell((r as Record<string, unknown>)[k])).join(' | ')} |`)].join('\n') + '\n';
}
