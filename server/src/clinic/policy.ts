import type { DatabaseSync } from 'node:sqlite';
import { ClinicError } from './errors.ts';
import { can, isRole, type Action, type Role } from './roles.ts';

/** References established by server authentication, never accepted from request JSON or token claims as authority. */
export interface LegacyActor { memberId: string; orgId: string; role: Role; credentialHash?: string }
export type PolicySubject =
  | { kind: 'legacy'; actor: LegacyActor }
  | { kind: 'membership'; accountId: string; membershipId: string; orgId: string };

export type PolicyAction = Action | 'clinic.profile.read' | 'org.stats.read' | 'plan.draft.edit_own'
  | 'delivery.status.read_own' | 'delivery.revoke_own';
export type Resource =
  | { kind: 'organization'; orgId: string }
  | { kind: 'staff'; orgId: string }
  | { kind: 'delivery'; orgId: string; authorMemberId: string }
  | { kind: 'draft'; orgId: string; authorMemberId: string };

interface Authority { orgId: string; authorMemberId: string; roles: readonly Role[] }
type Denial = 'forbidden' | 'not_found';

/** Single object policy. Unsupported actions/resources fail closed, including all future patient-data scopes. */
export function decide(authority: Authority, action: string, resource: Resource): Denial | null {
  if (resource.orgId !== authority.orgId) return 'not_found';
  const permission = action === 'org.stats.read' ? 'stats.view'
    : action === 'plan.draft.edit_own' ? 'plan.edit_own_draft'
    : action === 'delivery.status.read_own' || action === 'delivery.revoke_own' ? 'plan.issue' : action;
  const permitted = permission === 'clinic.profile.read' ? authority.roles.length > 0
    : authority.roles.some((role) => can(role, permission as Action));
  if (!permitted) return 'forbidden';
  if (action === 'delivery.status.read_own' || action === 'delivery.revoke_own') {
    return resource.kind === 'delivery' && resource.authorMemberId === authority.authorMemberId ? null : 'not_found';
  }
  if (action === 'plan.draft.edit_own' || action === 'plan.edit_own_draft') {
    return resource.kind === 'draft' && resource.authorMemberId === authority.authorMemberId ? null : 'not_found';
  }
  if (action === 'staff.manage') return resource.kind === 'organization' || resource.kind === 'staff' ? null : 'forbidden';
  return resource.kind === 'organization' ? null : 'forbidden';
}

/** Live database authority. Session/MFA verification is the caller's separate authentication boundary (ACCESS-03).
 * Membership subjects have no HTTP entry point yet. Legacy role stays authoritative until ACCESS-04; additive SQL
 * roles cannot widen an old bearer token. Disabled accounts/memberships suppress access through both paths.
 */
export class ClinicPolicy {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  constructor(db: DatabaseSync, now: () => number = Date.now) { this.db = db; this.now = now; }

  require(subject: PolicySubject, action: PolicyAction, resource: Resource): void {
    const denial = decide(this.resolve(subject), action, resource);
    if (denial) throw new ClinicError(denial);
  }

  private resolve(subject: PolicySubject): Authority {
    if (subject.kind === 'legacy') {
      const { memberId, orgId } = subject.actor;
      const transition = this.db.prepare('SELECT legacy_until FROM clinic_auth_transitions WHERE org = ?').get(orgId);
      if (transition && Number(transition.legacy_until) <= this.now()) throw new ClinicError('unauthenticated');
      const row = this.db.prepare(`SELECT l.role, l.active, l.token_hash, m.status, a.status AS account_status
        FROM clinic_members l JOIN organization_memberships m ON m.legacy_member_id = l.id AND m.organization_id = l.org
        JOIN accounts a ON a.id = m.account_id WHERE l.id = ? AND l.org = ?`).get(memberId, orgId) as
        { role: string; active: number; token_hash: string; status: string; account_status: string } | undefined;
      if (!row || subject.actor.credentialHash !== undefined && subject.actor.credentialHash !== row.token_hash || row.active !== 1 || row.status !== 'active' || !['active', 'pending_link'].includes(row.account_status)) {
        throw new ClinicError('unauthenticated');
      }
      return { orgId, authorMemberId: memberId, roles: isRole(row.role) ? [row.role] : [] };
    }
    const row = this.db.prepare(`SELECT m.legacy_member_id, m.status, a.status AS account_status
      FROM organization_memberships m JOIN accounts a ON a.id = m.account_id
      WHERE m.id = ? AND m.account_id = ? AND m.organization_id = ?`)
      .get(subject.membershipId, subject.accountId, subject.orgId) as
      { legacy_member_id: string | null; status: string; account_status: string } | undefined;
    if (!row || row.status !== 'active' || row.account_status !== 'active') throw new ClinicError('unauthenticated');
    const roles = this.db.prepare('SELECT role FROM organization_membership_roles WHERE membership_id = ?')
      .all(subject.membershipId).map((r) => r.role).filter(isRole);
    // Existing delivery authors remain their legacy IDs after account/member linking.
    return { orgId: subject.orgId, authorMemberId: row.legacy_member_id ?? subject.membershipId, roles };
  }
}
