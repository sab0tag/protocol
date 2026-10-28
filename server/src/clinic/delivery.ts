import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ClinicError, type Actor, type ClinicDirectory } from './directory.ts';
import { CarePlanV1 } from './carePlan.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type RedeemError = 'invalid' | 'expired' | 'used' | 'revoked' | 'tampered';
export class RedeemFailure extends Error {
  readonly code: RedeemError;
  constructor(code: RedeemError) { super(code); this.code = code; }
}

/**
 * One-time plan hand-over (spec PR-12). The code that goes into a link or QR is a random secret and never contains the
 * plan. The server keeps only its hash plus the plan until the first redemption, after which the plan is erased.
 * Plan content is never written to the audit log.
 */
export class PlanDelivery {
  private readonly db: DatabaseSync;
  private readonly dir: ClinicDirectory;
  private readonly now: () => number;

  constructor(db: DatabaseSync, dir: ClinicDirectory, now: () => number = Date.now) {
    this.db = db;
    this.dir = dir;
    this.now = now;
    db.exec(`
      CREATE TABLE IF NOT EXISTS plan_delivery (id TEXT PRIMARY KEY, org TEXT NOT NULL, issued_by TEXT NOT NULL,
        code_hash TEXT NOT NULL UNIQUE, plan TEXT, plan_hash TEXT NOT NULL, expires INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS plan_delivery_org ON plan_delivery (org, id);
    `);
  }

  /** The doctor must confirm the patient's consent; the plan must belong to the doctor's own organization. */
  issue(actor: Actor, input: { plan: unknown; patientConsent: boolean; ttlMs?: number }):
    { deliveryId: string; code: string; expiresAt: number } {
    this.dir.require(actor, 'plan.issue');
    if (input.patientConsent !== true) throw new ClinicError('bad_request');
    const parsed = CarePlanV1.safeParse(input.plan);
    if (!parsed.success || parsed.data.organizationId !== actor.orgId) throw new ClinicError('bad_request');
    const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_TTL_MS) throw new ClinicError('bad_request');
    const plan = JSON.stringify(parsed.data);
    const id = randomUUID(), code = randomBytes(32).toString('base64url'), expires = this.now() + ttl;
    this.db.prepare('INSERT INTO plan_delivery (id, org, issued_by, code_hash, plan, plan_hash, expires, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, actor.orgId, actor.memberId, hash(code), plan, hash(plan), expires, this.now());
    this.dir.record(actor, 'plan.issue', id);
    return { deliveryId: id, code, expiresAt: expires };
  }

  /** Revokes a pending delivery of the caller's own organization; foreign ids look non-existent. */
  revoke(actor: Actor, deliveryId: string): void {
    this.dir.require(actor, 'plan.issue');
    const r = this.db.prepare("UPDATE plan_delivery SET status = 'revoked', plan = NULL WHERE id = ? AND org = ? AND status = 'pending'")
      .run(deliveryId, actor.orgId);
    if (!r.changes) throw new ClinicError('not_found');
    this.dir.record(actor, 'plan.revoke', deliveryId);
  }

  /** Status of an own-organization delivery, for the doctor. */
  status(actor: Actor, deliveryId: string): 'pending' | 'redeemed' | 'revoked' | 'expired' {
    this.dir.require(actor, 'plan.issue');
    const r = this.db.prepare('SELECT status, expires FROM plan_delivery WHERE id = ? AND org = ?').get(deliveryId, actor.orgId) as
      { status: string; expires: number } | undefined;
    if (!r) throw new ClinicError('not_found');
    if (r.status === 'pending' && r.expires <= this.now()) return 'expired';
    return r.status as 'pending' | 'redeemed' | 'revoked';
  }

  /** Patient side, no account. Succeeds once; the stored plan is erased in the same statement that claims it. */
  redeem(code: string): CarePlanV1 {
    if (typeof code !== 'string' || code.length < 20 || code.length > 200) throw new RedeemFailure('invalid');
    const h = hash(code);
    const row = this.db.prepare('SELECT id, status, expires FROM plan_delivery WHERE code_hash = ?').get(h) as
      { id: string; status: string; expires: number } | undefined;
    if (!row) throw new RedeemFailure('invalid');
    if (row.status === 'revoked') throw new RedeemFailure('revoked');
    if (row.status === 'redeemed') throw new RedeemFailure('used');
    if (row.expires <= this.now()) {
      this.db.prepare("UPDATE plan_delivery SET plan = NULL WHERE id = ?").run(row.id);
      throw new RedeemFailure('expired');
    }
    const claimed = this.db.prepare(
      "UPDATE plan_delivery SET status = 'redeemed' WHERE id = ? AND status = 'pending' AND expires > ? RETURNING plan, plan_hash, org",
    ).get(row.id, this.now()) as { plan: string | null; plan_hash: string; org: string } | undefined;
    if (!claimed) throw new RedeemFailure('used');
    this.db.prepare('UPDATE plan_delivery SET plan = NULL WHERE id = ?').run(row.id);
    if (!claimed.plan || hash(claimed.plan) !== claimed.plan_hash) throw new RedeemFailure('tampered');
    const parsed = CarePlanV1.safeParse(JSON.parse(claimed.plan));
    if (!parsed.success || parsed.data.organizationId !== claimed.org) throw new RedeemFailure('tampered');
    return parsed.data;
  }

  /** Aggregate counts for the clinic's admins (PR-14): numbers only, never plan content or anything about a patient. */
  stats(actor: Actor, days = 30): ClinicStats {
    this.dir.require(actor, 'stats.view');
    const d = Math.min(Math.max(1, Math.floor(days) || 30), 365);
    const since = this.now() - d * 24 * 60 * 60 * 1000, t = this.now();
    const rows = this.db.prepare(
      `SELECT issued_by AS doctor, CASE WHEN status = 'pending' AND expires <= ? THEN 'expired' ELSE status END AS st, COUNT(*) AS n
       FROM plan_delivery WHERE org = ? AND created >= ? GROUP BY issued_by, st`).all(t, actor.orgId, since) as { doctor: string; st: string; n: number }[];
    const out: ClinicStats = { days: d, issued: 0, redeemed: 0, pending: 0, expired: 0, revoked: 0, byDoctor: [] };
    const per = new Map<string, number>();
    for (const r of rows) {
      out.issued += r.n;
      if (r.st === 'redeemed' || r.st === 'pending' || r.st === 'expired' || r.st === 'revoked') out[r.st] += r.n;
      per.set(r.doctor, (per.get(r.doctor) ?? 0) + r.n);
    }
    const names = new Map((this.db.prepare('SELECT id, name FROM clinic_members WHERE org = ?').all(actor.orgId) as { id: string; name: string }[]).map((m) => [m.id, m.name]));
    out.byDoctor = [...per].map(([id, issued]) => ({ memberId: id, displayName: names.get(id) ?? '', issued })).sort((a, b) => b.issued - a.issued);
    return out;
  }
}

export interface ClinicStats {
  days: number; issued: number; redeemed: number; pending: number; expired: number; revoked: number;
  byDoctor: { memberId: string; displayName: string; issued: number }[];
}
