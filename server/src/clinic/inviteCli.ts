// Operator-only bootstrap for an existing provisional staff record. Sends through configured SMTP, prints no secret.
import { existsSync } from 'node:fs';
import { Store } from '../store.ts';
import { assertCurrent } from '../db/migrate.ts';
import { ClinicDirectory } from './directory.ts';
import { StaffInvitations } from './invitations.ts';
import { invitationMailer } from './invitationMail.ts';
export async function inviteCli(args: string[], env: Record<string, string | undefined>, out: (s: string) => void, err: (s: string) => void): Promise<number> {
  const [org, member, email] = args;
  if (args.length !== 3 || !org || !member || !email || !env.DB_PATH || !existsSync(env.DB_PATH) || !env.APP_ORIGIN) {
    err('usage: clinic:invite <organization-id> <existing-member-id> <email>; requires existing DB_PATH, APP_ORIGIN and staff SMTP configuration'); return 2;
  }
  let store: Store | undefined;
  try {
    const mail = invitationMailer(env); if (!mail) throw Error('unavailable');
    store = new Store(env.DB_PATH); const db = store.database; assertCurrent(db);
    const target = db.prepare('SELECT name FROM clinic_members WHERE id = ? AND org = ?').get(member, org);
    if (!target) throw Error('not_found');
    const membership = db.prepare('SELECT id FROM organization_memberships WHERE legacy_member_id = ? AND organization_id = ?').get(member, org);
    if (!membership) throw Error('not_found');
    const roles = db.prepare('SELECT role FROM organization_membership_roles WHERE membership_id = ? ORDER BY role').all(membership.id!).map(r => r.role);
    const { roleSet } = await import('./invitations.ts');
    const result = await new StaffInvitations(db, new ClinicDirectory(db), env.APP_ORIGIN, mail).inviteOperator(org, {
      email, displayName: String(target.name), roles: roleSet(roles), targetMemberId: member,
    }, () => assertCurrent(db));
    out(`invitation: ${result.id}\nexpires: ${new Date(result.expiresAt).toISOString()}\nsubmitted to SMTP; recipient acceptance is still required`); return 0;
  } catch (e) {
    const code = (e as { code?: string }).code;
    err(`invitation refused: ${['pending', 'unversioned', 'newer_schema', 'checksum_mismatch', 'schema_drift', 'unrecognized_schema', 'not_found', 'conflict', 'bad_request'].includes(code ?? '') ? code : 'unavailable'}`); return 3;
  } finally { store?.close(); }
}
if (import.meta.main) process.exitCode = await inviteCli(process.argv.slice(2), process.env, console.log, console.error);
