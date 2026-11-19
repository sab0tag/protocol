// D176 (queue task 6): the staff access lifecycle on top of sign-in by invitation (ACCESS-04-B).
// - 90 days without a sign-in suspends a membership; only an admin of that clinic restores it. The clock runs from the
//   later of the last sign-in and the last restore (`active_since`), or from the membership's creation.
// - Old bearer tokens are retired when sign-in by invitation is on: none are issued, those issued live 30 days more.
// - An admin confirms the «who has access» list at least once a quarter; the portal says when it is due.
// Every step is written to the clinic's audit trail as ids and categories — never names, addresses or tokens.
import type { DatabaseSync } from 'node:sqlite';

const DAY = 86_400_000;
export const IDLE_MS = 90 * DAY;
export const TOKEN_LIFE_MS = 30 * DAY;
export const REVIEW_EVERY_MS = 90 * DAY;

/** The SQL for «idle»: no sign-in or restore for 90 days. `?` is the cut-off (now − 90 days). */
export const IDLE_SQL = 'COALESCE(m.active_since, m.created_at) <= ?';

/**
 * Marks idle active memberships as suspended and records it in each clinic's audit trail. For one account (at its
 * sign-in, so a late sign-in cannot reset the clock past the 90 days) or for all (the hourly housekeeping).
 * Runs inside the caller's transaction when there is one.
 */
export function suspendIdle(db: DatabaseSync, now: number, accountId?: string): number {
  // only identified people: a provisional record waiting for its invitation is not «idle», and old tokens have their own end
  const rows = db.prepare(`SELECT m.id, m.organization_id, m.legacy_member_id FROM organization_memberships m JOIN accounts a ON a.id = m.account_id
    WHERE m.status = 'active' AND a.status = 'active' AND m.suspended_at IS NULL AND ${IDLE_SQL}${accountId ? ' AND m.account_id = ?' : ''}`)
    .all(...(accountId ? [now - IDLE_MS, accountId] : [now - IDLE_MS])) as { id: string; organization_id: string; legacy_member_id: string | null }[];
  for (const r of rows) {
    db.prepare('UPDATE organization_memberships SET suspended_at = ? WHERE id = ? AND suspended_at IS NULL').run(now, r.id);
    db.prepare('INSERT INTO clinic_audit (org, at, actor, action, target) VALUES (?, ?, ?, ?, ?)')
      .run(r.organization_id, now, 'system', 'staff.suspend.idle', r.legacy_member_id ?? r.id);
  }
  return rows.length;
}

/** Sign-in by invitation on: every token still without a deadline gets one, 30 days ahead. Idempotent. */
export function retireTokens(db: DatabaseSync, now: number): number {
  return Number(db.prepare('UPDATE clinic_members SET token_until = ? WHERE token_until IS NULL').run(now + TOKEN_LIFE_MS).changes);
}
