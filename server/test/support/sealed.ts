// D176: plans wait sealed (ACCESS-07-B), so a test that damages a stored plan does it to the sealed bytes — or opens it
// with the patient's code, changes the plain text and seals it again, to reach the checks after the seal.
import type { DatabaseSync } from 'node:sqlite';
import { openPlan, sealPlan } from '../../src/clinic/delivery.ts';

/** Flips one stored byte of every (or one) waiting plan: the seal no longer opens. */
export function breakSeal(db: DatabaseSync, id?: string): void {
  const rows = (id ? db.prepare('SELECT id, plan FROM plan_delivery WHERE id = ?').all(id) : db.prepare('SELECT id, plan FROM plan_delivery').all()) as { id: string; plan: string | null }[];
  for (const r of rows) {
    if (!r.plan) continue;
    const b = Buffer.from(r.plan, 'base64url'); b[b.length - 1]! ^= 1;
    db.prepare('UPDATE plan_delivery SET plan = ? WHERE id = ?').run(b.toString('base64url'), r.id);
  }
}

/** Opens a waiting plan with its code, rewrites the plain text and seals it again; `hash` — the new plan_hash, or keep the old. */
export function reseal(db: DatabaseSync, d: { code: string; deliveryId: string }, change: (plain: string) => string, hash?: (plain: string) => string): void {
  const row = db.prepare('SELECT plan FROM plan_delivery WHERE id = ?').get(d.deliveryId) as { plan: string };
  const plain = change(openPlan(d.code, d.deliveryId, row.plan)!);
  if (hash) db.prepare('UPDATE plan_delivery SET plan = ?, plan_hash = ? WHERE id = ?').run(sealPlan(d.code, d.deliveryId, plain), hash(plain), d.deliveryId);
  else db.prepare('UPDATE plan_delivery SET plan = ? WHERE id = ?').run(sealPlan(d.code, d.deliveryId, plain), d.deliveryId);
}
