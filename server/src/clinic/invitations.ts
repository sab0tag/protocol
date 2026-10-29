import { bindMutation, startMutation, completeMutation, failMutation, performMutation, type Mutation } from '../db/mutations.ts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { immediate } from '../db/tx.ts';
import { address } from '../identity/address.ts';
import { Sessions } from '../identity/sessions.ts';
import { ClinicDirectory, type Actor } from './directory.ts';
import { isRole, type Role } from './roles.ts';
import type { InvitationMailer } from './invitationMail.ts';

export const INVITATION_MS = 72 * 3600_000;
export class InvitationError extends Error {
  readonly code: 'bad_request' | 'unavailable' | 'not_found' | 'recipient_mismatch' | 'conflict';
  constructor(code: 'bad_request' | 'unavailable' | 'not_found' | 'recipient_mismatch' | 'conflict') { super(code); this.code = code; }
}
interface Row { id: string; org: string; inviter: string; target_member: string | null; target_roles: string | null; target_version: number | null; email: string; display_name: string; roles: string; expires_at: number; state: string }
export interface InviteInput { email: string; displayName: string; roles: Role[]; targetMemberId?: string }
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export const roleSet = (value: unknown): Role[] => {
  if (!Array.isArray(value) || !value.length || value.length > 2 || !value.every(isRole) || new Set(value).size !== value.length) throw new InvitationError('bad_request');
  return [...value].sort();
};

/** Secrets exist only in mail transport memory. DB, API responses, audit and logs never contain an invitation link. */
export class StaffInvitations {
  private sessions: Sessions;
  private db: DatabaseSync; private dir: ClinicDirectory; private appOrigin: string; private mail: InvitationMailer | undefined; private now: () => number;
  constructor(db: DatabaseSync, dir: ClinicDirectory, appOrigin: string, mail?: InvitationMailer, now: () => number = Date.now) {
    this.db = db; this.dir = dir; this.appOrigin = appOrigin; this.mail = mail; this.now = now;
    this.sessions = new Sessions(db, now);
    const origin = new URL(appOrigin);
    if (origin.origin !== appOrigin || !(origin.protocol === 'https:' || origin.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname))) throw Error('invalid invitation app origin');
  }
  enabled(): boolean { return !!this.mail; }
  async invite(actor: Actor, input: InviteInput, mutation?: Mutation): Promise<{ id: string; expiresAt: number }> {
    if (!actor.session) throw new InvitationError('unavailable');
    return this.send(actor.orgId, actor.memberId, input, () => {
      this.dir.require(actor, 'staff.manage'); this.sessions.require(actor.session!.hash, { mfa: true, fresh: true });
    }, bindMutation(mutation,`${actor.session.accountId}/${actor.session.membershipId}/${actor.orgId}/invitation.create`));
  }
  /** Operator-only bootstrap, never mounted as HTTP. guard revalidates schema under the same write lock. */
  async inviteOperator(orgId: string, input: InviteInput, guard: () => void): Promise<{ id: string; expiresAt: number }> {
    if (!input.targetMemberId) throw new InvitationError('bad_request');
    return this.send(orgId, 'operator', input, guard);
  }
  private async send(org: string, inviter: string, input: InviteInput, authorize: () => void, mutation?: Mutation) {
    const sender = this.mail;
    const email = address(input.email), name = input.displayName.trim(), roles = roleSet(input.roles);
    if (!email || !name || name.length > 200) throw new InvitationError('bad_request');
    const id = randomUUID(), secret = randomBytes(32).toString('base64url'), expiresAt = this.now() + INVITATION_MS;
    let replay: { id: string; expiresAt: number } | undefined;
    const clinic = immediate(this.db, () => {
      authorize();
      const cached = startMutation<{ id: string; expiresAt: number }>(this.db,mutation);
      if (cached.hit) { replay = cached.value; return ''; }
      if (!sender) throw new InvitationError('unavailable');
      const organization = this.db.prepare('SELECT name FROM clinic_orgs WHERE id = ?').get(org);
      if (!organization) throw new InvitationError('not_found');
      let targetRoles: string | null = null, targetVersion: number | null = null;
      if (input.targetMemberId) {
        const target = this.db.prepare(`SELECT m.id, m.roles_version, a.status, l.active, l.name FROM organization_memberships m JOIN accounts a ON a.id = m.account_id
          JOIN clinic_members l ON l.id = m.legacy_member_id WHERE l.id = ? AND l.org = ? AND m.organization_id = ?`).get(input.targetMemberId, org, org);
        if (!target || target.active !== 1) throw new InvitationError('not_found');
        if (target.status !== 'pending_link') throw new InvitationError('conflict');
        if (target.name !== name) throw new InvitationError('bad_request');
        targetVersion = Number(target.roles_version);
        targetRoles = JSON.stringify(this.db.prepare('SELECT role FROM organization_membership_roles WHERE membership_id = ? ORDER BY role').all(target.id!).map(r => r.role));
        if (inviter === 'operator' && JSON.stringify(roles) !== targetRoles) throw new InvitationError('conflict');
      }
      // Resending replaces every pending invitation for this person/address in this clinic, never another clinic.
      this.db.prepare("UPDATE staff_invitations SET state = 'revoked' WHERE org = ? AND state IN ('sending','sent') AND (email = ? OR target_member = ?)")
        .run(org, email, input.targetMemberId ?? null);
      this.db.prepare(`INSERT INTO staff_invitations (id, org, inviter, target_member, target_roles, target_version, email, display_name, roles, secret_hash, created_at, expires_at, state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending')`).run(id, org, inviter, input.targetMemberId ?? null, targetRoles, targetVersion, email, name, JSON.stringify(roles), hash(secret), this.now(), expiresAt);
      this.audit(org, inviter, 'staff.invite.create', id);
      return String(organization.name);
    });
    if (replay) return replay;
    try {
      await sender!({ to: email, clinic, roles, expiresAt, link: `${this.appOrigin}/#/clinic/invite?code=${secret}` });
    } catch {
      immediate(this.db, () => {
        this.db.prepare("UPDATE staff_invitations SET state = 'failed' WHERE id = ? AND state = 'sending'").run(id);
        this.audit(org, inviter, 'staff.invite.delivery_failed', id); failMutation(this.db,mutation);
      });
      throw new InvitationError('unavailable');
    }
    immediate(this.db, () => {
      authorize(); // a revoked inviter cannot finish authorizing an invitation during SMTP I/O
      const r = this.db.prepare("UPDATE staff_invitations SET state = 'sent' WHERE id = ? AND state = 'sending' AND expires_at > ?").run(id, this.now());
      if (Number(r.changes) !== 1) throw new InvitationError('conflict');
      this.audit(org, inviter, 'staff.invite.sent', id); completeMutation(this.db,mutation,{ id, expiresAt });
    });
    return { id, expiresAt };
  }
  list(actor: Actor) {
    this.dir.require(actor, 'staff.manage');
    return this.db.prepare('SELECT id, email, display_name AS displayName, roles, expires_at AS expiresAt, state, target_member AS targetMemberId FROM staff_invitations WHERE org = ? ORDER BY created_at DESC LIMIT 100')
      .all(actor.orgId).map(r => ({ id: String(r.id), email: String(r.email), displayName: String(r.displayName), roles: JSON.parse(String(r.roles)) as Role[], expiresAt: Number(r.expiresAt), targetMemberId: r.targetMemberId === null ? null : String(r.targetMemberId), state: ['sending', 'sent'].includes(String(r.state)) && Number(r.expiresAt) <= this.now() ? 'expired' : String(r.state) }));
  }
  revoke(actor: Actor, id: string, mutation?: Mutation): void {
    immediate(this.db, () => {
      this.dir.require(actor, 'staff.manage');
      if (!actor.session) throw new InvitationError('unavailable');
      this.sessions.require(actor.session.hash, { mfa: true, fresh: true });
      return performMutation(this.db,bindMutation(mutation,`${actor.session.accountId}/${actor.session.membershipId}/${actor.orgId}/invitation.revoke/${id}`), () => {
      const row = this.db.prepare('SELECT state FROM staff_invitations WHERE id = ? AND org = ?').get(id, actor.orgId);
      if (!row) throw new InvitationError('not_found');
      if (row.state === 'accepted') throw new InvitationError('conflict');
      if (row.state === 'revoked') return;
      this.db.prepare("UPDATE staff_invitations SET state = 'revoked' WHERE id = ?").run(id);
      this.audit(actor.orgId, actor.memberId, 'staff.invite.revoke', id);
      });
    });
  }
  preview(sessionHash: string, secret: string) {
    const s = this.sessions.require(sessionHash, { mfa: true, fresh: true });
    const row = this.find(secret);
    if (!s.verifiedEmail || row.email !== s.verifiedEmail) throw new InvitationError('recipient_mismatch');
    const org = this.db.prepare('SELECT name FROM clinic_orgs WHERE id = ?').get(row.org)!;
    return { clinic: org.name, displayName: row.display_name, roles: JSON.parse(row.roles) as Role[], expiresAt: row.expires_at };
  }
  accept(sessionHash: string, secret: string, mutation?: Mutation): { organizationId: string; membershipId: string } {
    return immediate(this.db, () => {
      const s = this.sessions.require(sessionHash, { mfa: true, fresh: true });
      return performMutation(this.db,bindMutation(mutation,`${s.accountId}/invitation.accept`), () => {
      const row = this.find(secret);
      if (!s.verifiedEmail || row.email !== s.verifiedEmail) throw new InvitationError('recipient_mismatch');
      const existing = this.db.prepare('SELECT id FROM organization_memberships WHERE account_id = ? AND organization_id = ?').get(s.accountId, row.org);
      if (existing) throw new InvitationError('conflict'); // never silently grant more roles to an existing employee
      const roles = JSON.parse(row.roles) as Role[];
      let membershipId: string;
      if (row.target_member) {
        const target = this.db.prepare(`SELECT m.id, m.account_id, m.roles_version, a.status FROM organization_memberships m JOIN accounts a ON a.id = m.account_id
          JOIN clinic_members l ON l.id = m.legacy_member_id WHERE l.id = ? AND l.org = ? AND l.active = 1 AND m.status = 'active' AND m.organization_id = ?`)
          .get(row.target_member, row.org, row.org);
        if (!target || target.status !== 'pending_link' || target.roles_version !== row.target_version) throw new InvitationError('conflict');
        const currentRoles = JSON.stringify(this.db.prepare('SELECT role FROM organization_membership_roles WHERE membership_id = ? ORDER BY role').all(target.id!).map(r => r.role));
        if (currentRoles !== row.target_roles) throw new InvitationError('conflict');
        if (this.db.prepare('SELECT 1 FROM external_identities WHERE account_id = ?').get(target.account_id!)) throw new InvitationError('conflict');
        membershipId = String(target.id);
        this.db.prepare('UPDATE organization_memberships SET account_id = ? WHERE id = ?').run(s.accountId, membershipId);
        // Keep the old account as a disabled tombstone once no membership still uses it. IDs/authorship stay intact.
        this.db.prepare("UPDATE accounts SET status = 'disabled' WHERE id = ? AND NOT EXISTS (SELECT 1 FROM organization_memberships WHERE account_id = ?)").run(target.account_id!, target.account_id!);
      } else {
        membershipId = randomUUID();
        // A compatibility staff author record, with a random unusable credential that is never shown or mailed.
        const unusable = hash(randomBytes(32).toString('base64url'));
        this.db.prepare('INSERT INTO clinic_members (id, org, name, role, token_hash, created) VALUES (?, ?, ?, ?, ?, ?)')
          .run(membershipId, row.org, row.display_name, roles.includes('admin') ? 'admin' : 'doctor', unusable, this.now());
        this.db.prepare("INSERT INTO organization_memberships (id, account_id, organization_id, legacy_member_id, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)")
          .run(membershipId, s.accountId, row.org, membershipId, this.now());
      }
      this.db.prepare('DELETE FROM organization_membership_roles WHERE membership_id = ?').run(membershipId);
      for (const role of roles) this.db.prepare('INSERT INTO organization_membership_roles VALUES (?, ?)').run(membershipId, role);
      if (row.target_member) {
        this.db.prepare('UPDATE organization_memberships SET roles_version = roles_version + 1 WHERE id = ?').run(membershipId);
        const legacy = this.db.prepare('SELECT role FROM clinic_members WHERE id = ? AND org = ?').get(row.target_member,row.org)!;
        if (!roles.includes(legacy.role as Role)) this.db.prepare('UPDATE clinic_members SET role = ?, token_hash = ? WHERE id = ? AND org = ?')
          .run(roles.includes('admin') ? 'admin' : 'doctor',hash(randomBytes(32).toString('base64url')),row.target_member,row.org);
      }
      this.db.prepare("UPDATE staff_invitations SET state = 'accepted', accepted_account = ?, accepted_at = ? WHERE id = ?").run(s.accountId, this.now(), row.id);
      this.audit(row.org, membershipId, 'staff.invite.accept', row.id);
      return { organizationId: row.org, membershipId };
      });
    });
  }
  /** Remove contact-bearing invitation records thirty days after their expiry; audit retains only IDs/categories. */
  housekeeping(): void {
    this.db.prepare('DELETE FROM staff_invitations WHERE expires_at < ?').run(this.now() - 30 * 86400_000);
  }
  private find(secret: string): Row {
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new InvitationError('not_found');
    const row = this.db.prepare('SELECT * FROM staff_invitations WHERE secret_hash = ?').get(hash(secret)) as unknown as Row | undefined;
    if (!row || row.state !== 'sent' || row.expires_at <= this.now()) throw new InvitationError('not_found');
    if (row.inviter !== 'operator') {
      const inviter = this.db.prepare(`SELECT 1 FROM organization_memberships m JOIN accounts a ON a.id = m.account_id
        JOIN clinic_members l ON l.id = m.legacy_member_id AND l.org = m.organization_id JOIN organization_membership_roles r ON r.membership_id = m.id
        WHERE l.id = ? AND l.active = 1 AND m.organization_id = ? AND m.status = 'active' AND a.status = 'active' AND r.role = 'admin'`).get(row.inviter, row.org);
      if (!inviter) throw new InvitationError('not_found');
    }
    return row;
  }
  private audit(org: string, actor: string, action: string, id: string) {
    this.db.prepare('INSERT INTO clinic_audit (org, at, actor, action, target) VALUES (?, ?, ?, ?, ?)').run(org, this.now(), actor, action, id);
  }
}
