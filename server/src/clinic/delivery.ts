import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ClinicError, type Actor, type ClinicDirectory } from './directory.ts';
import { CarePlanV1, DeliverySnapshotV1, type RedeemedPlan } from './carePlan.ts';
import { immediate } from '../db/tx.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DeliveryStatus = 'pending' | 'redeemed' | 'revoked' | 'expired' | 'tampered';
export type RedeemError = 'invalid' | 'expired' | 'used' | 'revoked' | 'tampered';
export class RedeemFailure extends Error {
  readonly code: RedeemError;
  constructor(code: RedeemError) { super(code); this.code = code; }
}

/** Why a stored payload was rejected. Goes to the audit log as a category only — never the payload itself. */
type TamperKind = 'missing' | 'hash' | 'json' | 'schema' | 'org' | 'snapshot';
/** Points between SQL statements of `redeem`, for fault-injection tests. */
export type RedeemStep = 'read' | 'transition' | 'audit';

interface Row { id: string; org: string; status: string; expires: number; plan: string | null; plan_hash: string; issued_by: string; created: number; format: number }

/**
 * One-time plan hand-over (spec PR-12, ACCESS-00-H). The code that goes into a link or QR is a random secret and never
 * contains the plan. The server keeps only its hash plus the plan until the first redemption, after which the plan is
 * erased. Only the issuing doctor sees or revokes a delivery. Plan content is never written to the audit log.
 */
export class PlanDelivery {
  private readonly db: DatabaseSync;
  private readonly dir: ClinicDirectory;
  private readonly now: () => number;
  private readonly fault: ((step: RedeemStep) => void) | undefined;

  constructor(db: DatabaseSync, dir: ClinicDirectory, now: () => number = Date.now, fault?: (step: RedeemStep) => void) {
    this.db = db;
    this.dir = dir;
    this.now = now;
    this.fault = fault;
    // tables: src/db/migrations (0001_baseline); constructors never change the schema
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
    const id = randomUUID(), code = randomBytes(32).toString('base64url');
    let expires = 0;
    immediate(this.db, () => {
      const issuer = this.dir.issuer(actor), created = this.now(), issuedAt = new Date(created).toISOString();
      expires = created + ttl;
      const snapshot: DeliverySnapshotV1 = { schemaVersion: 1, snapshotId: id, issuedAt, issuer,
        source: { planId: parsed.data.planId, issuedAt: parsed.data.issuedAt, clinician: parsed.data.clinician },
        plan: { ...parsed.data, issuedAt, clinician: { displayName: issuer.displayName, organizationName: issuer.organizationName } } };
      if (!DeliverySnapshotV1.safeParse(snapshot).success) throw new ClinicError('bad_request');
      const plan = JSON.stringify(snapshot);
      this.db.prepare('INSERT INTO plan_delivery (id, org, issued_by, code_hash, plan, plan_hash, expires, created, format) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2)')
        .run(id, actor.orgId, actor.memberId, hash(code), plan, hash(plan), expires, created);
      this.dir.record(actor, 'plan.issue', id);
    });
    return { deliveryId: id, code, expiresAt: expires };
  }

  /** Revokes the caller's own pending delivery. A colleague's or another organization's id looks non-existent. */
  revoke(actor: Actor, deliveryId: string): void {
    this.dir.require(actor, 'delivery.revoke_own', { kind: 'delivery', orgId: actor.orgId, authorMemberId: actor.memberId });
    immediate(this.db, () => {
      this.dir.require(actor, 'delivery.revoke_own', this.deliveryResource(actor, deliveryId));
      const r = this.db.prepare("UPDATE plan_delivery SET status = 'revoked', plan = NULL WHERE id = ? AND org = ? AND issued_by = ? AND status = 'pending'")
        .run(deliveryId, actor.orgId, actor.memberId);
      if (!r.changes) throw new ClinicError('not_found');
      this.dir.record(actor, 'plan.revoke', deliveryId);
    });
  }

  /** Status of the caller's own delivery. A colleague's or another organization's id looks non-existent. */
  status(actor: Actor, deliveryId: string): DeliveryStatus {
    this.dir.require(actor, 'delivery.status.read_own', this.deliveryResource(actor, deliveryId));
    const r = this.db.prepare('SELECT status, expires FROM plan_delivery WHERE id = ? AND org = ? AND issued_by = ?')
      .get(deliveryId, actor.orgId, actor.memberId) as { status: string; expires: number } | undefined;
    if (!r) throw new ClinicError('not_found');
    if (r.status === 'pending' && r.expires <= this.now()) return 'expired';
    return r.status as DeliveryStatus;
  }

  private deliveryResource(actor: Actor, deliveryId: string): { kind: 'delivery'; orgId: string; authorMemberId: string } {
    this.dir.require(actor, 'plan.issue');
    const row = this.db.prepare('SELECT org, issued_by FROM plan_delivery WHERE id = ? AND org = ? AND issued_by = ?')
      .get(deliveryId, actor.orgId, actor.memberId) as { org: string; issued_by: string } | undefined;
    if (!row) throw new ClinicError('not_found');
    return { kind: 'delivery', orgId: row.org, authorMemberId: row.issued_by };
  }

  /**
   * Patient side, no account. Succeeds once. Reading, the status change, erasing the payload and the audit entry happen
   * in one `BEGIN IMMEDIATE` transaction, and the plan is returned only after it commits. A stored payload that fails
   * verification ends in the terminal `tampered` state — a committed business outcome, not a rollback. A lost response
   * after commit is not recoverable yet (ACCESS-07-C).
   */
  redeem(code: string): CarePlanV1 { return this.redeemWithProvenance(code).plan; }

  /** Keeps the old plan field for older clients; provenance is only trusted on this server redemption path. */
  redeemWithProvenance(code: string): RedeemedPlan {
    if (typeof code !== 'string' || code.length < 20 || code.length > 200) throw new RedeemFailure('invalid');
    const h = hash(code);
    const out = immediate(this.db, (): RedeemedPlan | RedeemError => {
      const row = this.db.prepare('SELECT id, org, status, expires, plan, plan_hash, issued_by, created, format FROM plan_delivery WHERE code_hash = ?').get(h) as Row | undefined;
      this.fault?.('read');
      if (!row) return 'invalid';
      if (row.status === 'revoked') return 'revoked';
      if (row.status === 'redeemed') return 'used';
      if (row.status === 'tampered') return 'tampered';
      if (row.status !== 'pending') throw new Error(`unknown delivery status: ${row.status}`);
      if (row.expires <= this.now()) {
        if (row.plan !== null) this.db.prepare('UPDATE plan_delivery SET plan = NULL WHERE id = ?').run(row.id);
        return 'expired';
      }
      const verdict = this.verify(row);
      if (typeof verdict === 'string') {
        this.claim(row.id, 'tampered');
        this.fault?.('transition');
        this.dir.recordSystem(row.org, 'patient_link', `plan.tampered.${verdict}`, row.id);
        this.fault?.('audit');
        return 'tampered';
      }
      this.claim(row.id, 'redeemed');
      this.fault?.('transition');
      this.dir.recordSystem(row.org, 'patient_link', 'plan.redeem', row.id);
      this.fault?.('audit');
      return verdict;
    });
    if (typeof out === 'string') throw new RedeemFailure(out);
    return out;
  }

  /** Moves a pending delivery to a terminal state and erases its payload. Inside the caller's transaction. */
  private claim(id: string, to: 'redeemed' | 'tampered'): void {
    const r = this.db.prepare("UPDATE plan_delivery SET status = ?, plan = NULL WHERE id = ? AND status = 'pending'").run(to, id);
    if (r.changes !== 1) throw new Error('delivery changed under an immediate transaction');
  }

  private verify(row: Row): RedeemedPlan | TamperKind {
    if (row.plan === null) return 'missing';
    if (hash(row.plan) !== row.plan_hash) return 'hash';
    let json: unknown;
    try { json = JSON.parse(row.plan); } catch { return 'json'; }
    if (row.format === 1) {
      const parsed = CarePlanV1.safeParse(json);
      if (!parsed.success) return 'schema';
      if (parsed.data.organizationId !== row.org) return 'org';
      return { plan: parsed.data }; // no historical issuer snapshot exists: never synthesize one from today's name
    }
    if (row.format !== 2) return 'snapshot';
    const parsed = DeliverySnapshotV1.safeParse(json);
    if (!parsed.success) return 'schema';
    const { plan, ...snapshot } = parsed.data;
    if (snapshot.issuer.organizationId !== row.org || plan.organizationId !== row.org) return 'org';
    if (snapshot.snapshotId !== row.id || snapshot.issuer.memberId !== row.issued_by ||
      Date.parse(snapshot.issuedAt) !== row.created || plan.issuedAt !== snapshot.issuedAt ||
      plan.planId !== snapshot.source.planId || plan.clinician.displayName !== snapshot.issuer.displayName ||
      plan.clinician.organizationName !== snapshot.issuer.organizationName) return 'snapshot';
    return { plan, snapshot };
  }

  /** Aggregate counts for the clinic's admins (PR-14): numbers only, never plan content or anything about a patient. */
  stats(actor: Actor, days = 30): ClinicStats {
    this.dir.require(actor, 'org.stats.read');
    const d = Math.min(Math.max(1, Math.floor(days) || 30), 365);
    const since = this.now() - d * 24 * 60 * 60 * 1000, t = this.now();
    const rows = this.db.prepare(
      `SELECT issued_by AS doctor, CASE WHEN status = 'pending' AND expires <= ? THEN 'expired' ELSE status END AS st, COUNT(*) AS n
       FROM plan_delivery WHERE org = ? AND created >= ? GROUP BY issued_by, st`).all(t, actor.orgId, since) as { doctor: string; st: string; n: number }[];
    const out: ClinicStats = { days: d, issued: 0, redeemed: 0, pending: 0, expired: 0, revoked: 0, tampered: 0, byDoctor: [] };
    const per = new Map<string, number>();
    for (const r of rows) {
      out.issued += r.n;
      if (r.st === 'redeemed' || r.st === 'pending' || r.st === 'expired' || r.st === 'revoked' || r.st === 'tampered') out[r.st] += r.n;
      per.set(r.doctor, (per.get(r.doctor) ?? 0) + r.n);
    }
    const names = new Map((this.db.prepare('SELECT id, name FROM clinic_members WHERE org = ?').all(actor.orgId) as { id: string; name: string }[]).map((m) => [m.id, m.name]));
    out.byDoctor = [...per].map(([id, issued]) => ({ memberId: id, displayName: names.get(id) ?? '', issued })).sort((a, b) => b.issued - a.issued);
    return out;
  }
}

export interface ClinicStats {
  days: number; issued: number; redeemed: number; pending: number; expired: number; revoked: number; tampered: number;
  byDoctor: { memberId: string; displayName: string; issued: number }[];
}
