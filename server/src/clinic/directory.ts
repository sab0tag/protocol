import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { immediate } from '../db/tx.ts';
import { isRole, type Role } from './roles.ts';
import { ClinicError } from './errors.ts';
import { ClinicPolicy, type LegacyActor, type PolicyAction, type Resource } from './policy.ts';
export { ClinicError, type DirectoryError } from './errors.ts';
import { projectLegacyMember } from './memberships.ts';
import { Sessions } from '../identity/sessions.ts';
import { IdentityError } from '../identity/errors.ts';

/** The caller as the server knows it. `orgId` comes from the member record, never from the request. */
export type Actor = LegacyActor & { session?: { hash: string; accountId: string; membershipId: string } };

export interface Member { id: string; displayName: string; role: Role; active: boolean }
export interface AuditEntry { at: number; actor: string; action: string; target: string | null }

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

/**
 * Organizations, staff, roles and the audit trail. Every operation takes the authenticated `Actor`; the organization is
 * taken from it, so another tenant's ids simply do not exist for the caller (`not_found`, never `forbidden`).
 * The audit log holds who did what to which id — never plan or patient content (TENANT-05).
 */
export class ClinicDirectory {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly policy: ClinicPolicy;
  private readonly sessions: Sessions;

  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    this.policy = new ClinicPolicy(db);
    this.sessions = new Sessions(db, now);
    // tables: src/db/migrations (0001_baseline); constructors never change the schema
  }

  /**
   * Founds a tenant with its first admin. The returned token is shown once; only its hash is stored. One `BEGIN IMMEDIATE`
   * transaction owns the whole operation; `guard` runs first inside it, under the write lock (the CLI re-checks the
   * schema version there), and anything it throws leaves no organization, admin or audit entry behind.
   */
  createOrganization(name: string, adminName: string, guard?: () => void): { orgId: string; adminId: string; token: string } {
    const n = name.trim(), a = adminName.trim();
    if (!n || !a || n.length > 200 || a.length > 200) throw new ClinicError('bad_request');
    const orgId = randomUUID(), adminId = randomUUID(), token = newToken();
    immediate(this.db, () => { // never an organization without its admin
      guard?.();
      this.db.prepare('INSERT INTO clinic_orgs (id, name, created) VALUES (?, ?, ?)').run(orgId, n, this.now());
      this.db.prepare('INSERT INTO clinic_members (id, org, name, role, token_hash, created) VALUES (?, ?, ?, ?, ?, ?)')
        .run(adminId, orgId, a, 'admin', hash(token), this.now());
      projectLegacyMember(this.db, adminId);
      this.audit(orgId, adminId, 'org.create', orgId);
    });
    return { orgId, adminId, token };
  }

  /** Checked against the database on every call, so deactivation takes effect at once (TENANT-06). */
  authenticate(token: string | undefined): Actor | null {
    if (!token) return null;
    const r = this.db.prepare('SELECT id, org, role, active FROM clinic_members WHERE token_hash = ?').get(hash(token)) as
      { id: string; org: string; role: string; active: number } | undefined;
    if (!r || !r.active || !isRole(r.role)) return null;
    const actor = { memberId: r.id, orgId: r.org, role: r.role };
    try { this.require(actor, 'clinic.profile.read'); } catch (e) {
      if (e instanceof ClinicError) return null;
      throw e;
    }
    return actor;
  }

  /** Every service operation re-resolves live authority; role on the Actor is never trusted. */
  require(actor: Actor, action: PolicyAction, resource: Resource = { kind: 'organization', orgId: actor.orgId }): void {
    if (actor.session) {
      const s = this.sessions.require(actor.session.hash, { mfa: true });
      if (s.account_id !== actor.session.accountId) throw new IdentityError('unauthorized');
      const member = this.db.prepare('SELECT m.legacy_member_id FROM organization_memberships m JOIN clinic_members l ON l.id = m.legacy_member_id AND l.org = m.organization_id WHERE m.id = ? AND m.account_id = ? AND m.organization_id = ? AND l.active = 1')
        .get(actor.session.membershipId, s.account_id, actor.orgId);
      // ACCESS-04 creates/migrates the legacy staff shadow; no implicit clinical identity is created here.
      if (!member || member.legacy_member_id !== actor.memberId) throw new IdentityError('unauthorized');
      this.policy.require({ kind: 'membership', accountId: s.account_id, membershipId: actor.session.membershipId, orgId: actor.orgId }, action, resource);
    } else this.policy.require({ kind: 'legacy', actor }, action, resource);
  }

  authenticateSession(hash: string, orgId?: string): Actor {
    const s = this.sessions.require(hash, { mfa: true }), contexts = this.sessions.contexts(s.account_id);
    const selected = orgId ? contexts.find(m => m.organizationId === orgId) : contexts.length === 1 ? contexts[0] : undefined;
    if (!selected) throw new IdentityError('context_required');
    const m = this.db.prepare('SELECT legacy_member_id FROM organization_memberships WHERE id = ?').get(selected.membershipId);
    if (typeof m?.legacy_member_id !== 'string') throw new IdentityError('forbidden');
    const role = selected.roles.includes('admin') ? 'admin' : selected.roles.includes('doctor') ? 'doctor' : null;
    if (!role) throw new IdentityError('forbidden');
    const actor: Actor = { memberId: m.legacy_member_id, orgId: selected.organizationId, role,
      session: { hash, accountId: s.account_id, membershipId: selected.membershipId } };
    this.require(actor, 'clinic.profile.read'); return actor;
  }

  private fresh(actor: Actor): void {
    if (actor.session) this.sessions.require(actor.session.hash, { mfa: true, fresh: true });
  }

  /** Issue-time identity snapshot. Caller holds the write transaction containing authorization and delivery. */
  issuer(actor: Actor): { memberId: string; membershipId: string; organizationId: string; displayName: string; organizationName: string } {
    if (!this.db.isTransaction) throw new Error('issuer snapshot requires the delivery transaction');
    this.require(actor, 'plan.issue');
    const me = this.profile(actor);
    const m = this.db.prepare('SELECT id FROM organization_memberships WHERE legacy_member_id = ? AND organization_id = ?')
      .get(actor.memberId, actor.orgId) as { id: string } | undefined;
    if (!m) throw new ClinicError('unauthenticated');
    return { memberId: me.memberId, membershipId: m.id, organizationId: me.organizationId,
      displayName: me.displayName, organizationName: me.organizationName };
  }

  /** What the portal needs to compose a plan: the caller's own name and organization. */
  profile(actor: Actor): { memberId: string; role: Role; displayName: string; organizationId: string; organizationName: string } {
    this.require(actor, 'clinic.profile.read');
    const r = this.db.prepare('SELECT m.name AS name, m.role AS role, m.active AS active, o.name AS org FROM clinic_members m JOIN clinic_orgs o ON o.id = m.org WHERE m.id = ? AND m.org = ?')
      .get(actor.memberId, actor.orgId) as { name: string; role: Role; active: number; org: string } | undefined;
    if (!r || !r.active) throw new ClinicError('unauthenticated');
    const roles = actor.session ? this.sessions.contexts(actor.session.accountId).find(m => m.membershipId === actor.session!.membershipId)?.roles : undefined;
    const role: Role = roles ? roles.includes('admin') ? 'admin' : 'doctor' : r.role;
    return { memberId: actor.memberId, role, displayName: r.name, organizationId: actor.orgId, organizationName: r.org };
  }

  addStaff(actor: Actor, input: { displayName: string; role: Role }): { memberId: string; token: string } {
    this.require(actor, 'staff.manage');
    const name = input.displayName.trim();
    if (!name || name.length > 200 || !isRole(input.role)) throw new ClinicError('bad_request');
    const id = randomUUID(), token = newToken();
    immediate(this.db, () => {
      this.require(actor, 'staff.manage');
      this.fresh(actor);
      this.db.prepare('INSERT INTO clinic_members (id, org, name, role, token_hash, created) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, actor.orgId, name, input.role, hash(token), this.now());
      projectLegacyMember(this.db, id);
      this.audit(actor.orgId, actor.memberId, 'staff.add', id);
    });
    return { memberId: id, token };
  }

  listStaff(actor: Actor): Member[] {
    this.require(actor, 'staff.manage');
    return (this.db.prepare('SELECT id, name, role, active FROM clinic_members WHERE org = ? ORDER BY created, id').all(actor.orgId) as
      { id: string; name: string; role: Role; active: number }[]).map((m) => ({ id: m.id, displayName: m.name, role: m.role, active: !!m.active }));
  }

  setRole(actor: Actor, memberId: string, role: Role): void {
    this.require(actor, 'staff.manage');
    if (!isRole(role)) throw new ClinicError('bad_request');
    immediate(this.db, () => {
      this.require(actor, 'staff.manage');
      this.fresh(actor);
      const m = this.target(actor, memberId);
      if (m.admin && role !== 'admin' && m.active) this.keepAnAdmin(actor.orgId, memberId);
      this.db.prepare('UPDATE clinic_members SET role = ? WHERE id = ? AND org = ?').run(role, memberId, actor.orgId);
      projectLegacyMember(this.db, memberId);
      this.audit(actor.orgId, actor.memberId, `staff.role.${role}`, memberId);
    });
  }

  deactivate(actor: Actor, memberId: string): void {
    this.require(actor, 'staff.manage');
    immediate(this.db, () => {
      this.require(actor, 'staff.manage');
      this.fresh(actor);
      const m = this.target(actor, memberId);
      if (m.admin && m.active) this.keepAnAdmin(actor.orgId, memberId);
      this.db.prepare('UPDATE clinic_members SET active = 0 WHERE id = ? AND org = ?').run(memberId, actor.orgId);
      projectLegacyMember(this.db, memberId, false);
      this.audit(actor.orgId, actor.memberId, 'staff.deactivate', memberId);
    });
  }

  /** Replaces a lost token: the old one stops working immediately. */
  rotateToken(actor: Actor, memberId: string): string {
    this.require(actor, 'staff.manage');
    return immediate(this.db, () => {
      this.require(actor, 'staff.manage');
      this.fresh(actor);
      this.target(actor, memberId);
      const token = newToken();
      this.db.prepare('UPDATE clinic_members SET token_hash = ? WHERE id = ? AND org = ?').run(hash(token), memberId, actor.orgId);
      this.audit(actor.orgId, actor.memberId, 'staff.token.rotate', memberId);
      return token;
    });
  }

  auditLog(actor: Actor, limit = 100): AuditEntry[] {
    this.require(actor, 'staff.manage');
    return this.db.prepare('SELECT at, actor, action, target FROM clinic_audit WHERE org = ? ORDER BY id DESC LIMIT ?')
      .all(actor.orgId, Math.min(Math.max(1, limit), 500)) as unknown as AuditEntry[];
  }

  /** Records an action of another module (plans, delivery). `target` is an id, never content. */
  record(actor: Actor, action: string, target: string | null): void { this.audit(actor.orgId, actor.memberId, action, target); }

  /**
   * Records an action with no authenticated staff member behind it. `patient_link` marks an anonymous redemption by
   * whoever holds the link — not a verified patient identity. Runs inside the caller's transaction; never the secret.
   */
  recordSystem(orgId: string, actor: 'patient_link', action: string, target: string): void { this.audit(orgId, actor, action, target); }

  private target(actor: Actor, memberId: string): { role: Role; active: boolean; admin: boolean } {
    const m = this.db.prepare('SELECT role, active FROM clinic_members WHERE id = ? AND org = ?').get(memberId, actor.orgId) as
      { role: Role; active: number } | undefined;
    if (!m) throw new ClinicError('not_found');
    this.require(actor, 'staff.manage', { kind: 'staff', orgId: actor.orgId });
    const membershipAdmin = this.db.prepare(`SELECT 1 FROM organization_memberships ms JOIN organization_membership_roles r ON r.membership_id = ms.id
      WHERE ms.legacy_member_id = ? AND ms.organization_id = ? AND r.role = 'admin'`).get(memberId, actor.orgId);
    return { role: m.role, active: !!m.active, admin: m.role === 'admin' || !!membershipAdmin };
  }

  private keepAnAdmin(orgId: string, leaving: string): void {
    const others = this.db.prepare(`SELECT COUNT(*) AS n FROM clinic_members l
      JOIN organization_memberships m ON m.legacy_member_id = l.id AND m.organization_id = l.org
      JOIN accounts a ON a.id = m.account_id
      WHERE l.org = ? AND l.active = 1 AND l.id != ? AND m.status = 'active'
        AND ((l.role = 'admin' AND a.status IN ('pending_link', 'active')) OR (a.status = 'active' AND EXISTS
          (SELECT 1 FROM organization_membership_roles r WHERE r.membership_id = m.id AND r.role = 'admin')))`).get(orgId, leaving) as { n: number };
    if (others.n === 0) throw new ClinicError('last_admin');
  }

  private audit(org: string, actor: string, action: string, target: string | null): void {
    this.db.prepare('INSERT INTO clinic_audit (org, at, actor, action, target) VALUES (?, ?, ?, ?, ?)').run(org, this.now(), actor, action, target);
  }
}
