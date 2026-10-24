// D119: counts of a day that no record holds — a «не знайдено» shown, «Чому?» opened, a tip shown or taken, the 103 card, a report
// printed or shared, rows entered off a doctor's paper and corrected later, a push that came or was opened (the service worker
// writes those two, public/push-sw.js). Only numbers and, for «once a day», a token; on this device only, 10 weeks.
import { format, subDays } from 'date-fns';
import { db, type Tally } from './db';

export type TallyKey = 'nf' | 'why' | 'topup_shown' | 'topup_taken' | 'danger' | 'report' | 'photo_rows' | 'photo_edit' | 'rem_sent' | 'rem_open';
const KEEP_DAYS = 70;

async function add(key: TallyKey, by: number, token?: string): Promise<void> {
  const day = format(new Date(), 'yyyy-MM-dd');
  try {
    await db.transaction('rw', db.tally, async () => {
      const row: Tally = (await db.tally.get(day)) ?? { day, n: {} };
      if (token !== undefined) {
        const seen = row.seen?.[key] ?? [];
        if (seen.includes(token)) return;
        row.seen = { ...row.seen, [key]: [...seen, token].slice(-200) };
      }
      row.n[key] = (row.n[key] ?? 0) + by;
      await db.tally.put(row);
    });
    if (Math.random() < 0.05) await db.tally.where('day').below(format(subDays(new Date(), KEEP_DAYS), 'yyyy-MM-dd')).delete();
  } catch { /* a count is never worth an error on screen */ }
}

/** Count `by` today. */
export const count = (key: TallyKey, by = 1) => add(key, by);
/** Count once a day for this token (the same «не знайдено» shown again, the same card drawn again — once). */
export const countOnce = (key: TallyKey, token: string) => add(key, 1, token.trim().toLowerCase().slice(0, 80));

/** The days `from`…`to`, summed by key. */
export async function tallies(from: string, to: string, target = db): Promise<Partial<Record<TallyKey, number>>> {
  const out: Partial<Record<TallyKey, number>> = {};
  try {
    for (const r of await target.tally.where('day').between(from, to, true, true).toArray()) {
      for (const [k, v] of Object.entries(r.n)) out[k as TallyKey] = (out[k as TallyKey] ?? 0) + v;
    }
  } catch { /* an older database — nothing counted */ }
  return out;
}
