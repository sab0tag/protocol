import type { DatabaseSync } from 'node:sqlite';

/** Additive ACCESS-02 projection. Caller owns the transaction containing legacy change + projection + audit.
 *  A pending_link account cannot authenticate via OIDC; no identity is inferred from a legacy token or name. */
export function projectLegacyMember(db: DatabaseSync, memberId: string, replaceRole = true): void {
  if (!db.isTransaction) throw new Error('membership projection requires the legacy transaction');
  const member = db.prepare('SELECT id, org, role, active, created FROM clinic_members WHERE id = ?').get(memberId) as
    { id: string; org: string; role: string; active: number; created: number } | undefined;
  if (!member) throw new Error('legacy member not found');
  const existing = db.prepare('SELECT id FROM organization_memberships WHERE legacy_member_id = ?').get(memberId) as { id: string } | undefined;
  if (!existing) {
    db.prepare("INSERT INTO accounts (id, status, created_at) VALUES (?, 'pending_link', ?)").run(member.id, member.created);
    db.prepare('INSERT INTO organization_memberships (id, account_id, organization_id, legacy_member_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(member.id, member.id, member.org, member.id, member.active ? 'active' : 'inactive', member.created);
  } else {
    db.prepare('UPDATE organization_memberships SET status = ? WHERE id = ?').run(member.active ? 'active' : 'inactive', existing.id);
  }
  const membershipId = existing?.id ?? member.id;
  // The old single-role endpoint means replacement, never an implicit admin+doctor escalation.
  if (existing && replaceRole) {
    const roles = db.prepare('SELECT role FROM organization_membership_roles WHERE membership_id = ?').all(membershipId);
    if (roles.length !== 1 || roles[0]?.role !== member.role) db.prepare('UPDATE organization_memberships SET roles_version = roles_version + 1 WHERE id = ?').run(membershipId);
  }
  if (!existing || replaceRole) {
    db.prepare('DELETE FROM organization_membership_roles WHERE membership_id = ?').run(membershipId);
    db.prepare('INSERT INTO organization_membership_roles (membership_id, role) VALUES (?, ?)').run(membershipId, member.role);
  }
}
