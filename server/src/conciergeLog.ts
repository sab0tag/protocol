// D91: the concierge's log — kept 30 days; each Sunday the past ISO week is written out for the weekly review as
// concierge-log-YYYY-WW.jsonl: a pseudonymous label instead of the vault, names in free text replaced. The findings live
// on in tests/fixtures/concierge-cases.yaml as rewritten rows, never as the conversations themselves.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scrubNames, userLabel } from './concierge.ts';
import type { Store } from './store.ts';

export const KEEP_DAYS = 30;
const DAY = 86_400_000;

/** ISO week of a date: [year, week, Monday 00:00 UTC]. */
export function isoWeek(d: Date): [number, number, number] {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const day = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  const monday = t - day * DAY, thursday = monday + 3 * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * DAY)) + 1;
  return [year, week, monday];
}

/** The past week's export (once), and the 30-day purge. Returns what it did, for tests. */
export function conciergeHousekeeping(store: Store, dir: string, now: Date): { exported?: string; purged: number } {
  const purged = store.purgeConcierge(now.getTime() - KEEP_DAYS * DAY);
  const [, , monday] = isoWeek(now);
  const [y, w] = isoWeek(new Date(monday - DAY)); // the week that ended last Sunday
  const file = join(dir, `concierge-log-${y}-${String(w).padStart(2, '0')}.jsonl`);
  if (existsSync(file)) return { purged };
  const rows = store.conciergeBetween(monday - 7 * DAY, monday);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, rows.map((r) => {
    const rec = JSON.parse(r.record) as Record<string, unknown>;
    return JSON.stringify({ ...rec, user: userLabel(r.vault), input: scrubNames(String(rec.input ?? '')), outcome: r.outcome ?? 'ignored',
      ...(r.edit ? { edit: JSON.parse(r.edit) } : {}) });
  }).join('\n') + (rows.length ? '\n' : ''));
  return { exported: file, purged };
}
