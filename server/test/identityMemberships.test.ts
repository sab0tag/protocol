import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ClinicDirectory } from '../src/clinic/directory.ts';
import { projectLegacyMember } from '../src/clinic/memberships.ts';
import { MIGRATIONS, migrate } from '../src/db/migrate.ts';
import { Store } from '../src/store.ts';

const identityMigrations = () => MIGRATIONS().slice(0, 2);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const rows = (db: DatabaseSync, table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((r) => ({ ...r }));
const baseline = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, [MIGRATIONS()[0]!]);
  db.exec("INSERT INTO clinic_orgs VALUES ('org-a', 'Clinic A', 10), ('org-b', 'Clinic B', 20)");
  db.prepare('INSERT INTO clinic_members VALUES (?, ?, ?, ?, ?, ?, ?)').run('staff-a', 'org-a', 'Same name', 'doctor', hash('a'.repeat(43)), 1, 11);
  db.prepare('INSERT INTO clinic_members VALUES (?, ?, ?, ?, ?, ?, ?)').run('staff-b', 'org-b', 'Same name', 'admin', hash('b'.repeat(43)), 0, 21);
  db.exec("INSERT INTO clinic_audit (org, at, actor, action, target) VALUES ('org-a', 12, 'staff-a', 'plan.issue', 'delivery-a')");
  db.prepare('INSERT INTO plan_delivery VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('delivery-a', 'org-a', 'staff-a', hash('code'), '{"title":"synthetic"}', hash('{"title":"synthetic"}'), 1000, 'pending', 12);
  return db;
};
const rig = () => {
  const store = Store.migrated(':memory:');
  const db = store.database;
  const dir = new ClinicDirectory(db);
  const org = dir.createOrganization('Clinic', 'Admin');
  const admin = dir.authenticate(org.token)!;
  const doctor = dir.addStaff(admin, { displayName: 'Doctor', role: 'doctor' });
  return { store, db, dir, org, admin, doctor };
};
const projection = (db: DatabaseSync) => Object.fromEntries(['accounts', 'organization_memberships', 'organization_membership_roles', 'clinic_orgs', 'clinic_members', 'clinic_audit'].map((t) => [t, rows(db, t)]));

describe('ACCESS-02 additive migration', () => {
  it('the identity migration prefix preserves baseline and reaches version 2', () => {
    expect(identityMigrations().map((m) => [m.version, m.name])).toEqual([[1, 'baseline'], [2, 'identity_memberships']]);
    expect(MIGRATIONS()[0]!.checksum).toBe('fdcbe811adc0a88ba9eb04d03372b431d8266eb68758e3dc466a32228be3b74d');
    const db = new DatabaseSync(':memory:');
    expect(migrate(db, identityMigrations()).applied).toEqual([1, 2]);
    expect(rows(db, 'accounts')).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  it('preserves legacy records, IDs, tokens, delivery authors and audit; equal names stay separate pending accounts', () => {
    const db = baseline();
    const tables = ['clinic_orgs', 'clinic_members', 'plan_delivery', 'clinic_audit'];
    const before = Object.fromEntries(tables.map((t) => [t, rows(db, t)]));
    expect(migrate(db, identityMigrations()).applied).toEqual([2]);
    expect(Object.fromEntries(tables.map((t) => [t, rows(db, t)]))).toEqual(before);
    expect(rows(db, 'accounts')).toEqual([
      { id: 'staff-a', status: 'pending_link', created_at: 11 },
      { id: 'staff-b', status: 'pending_link', created_at: 21 },
    ]);
    expect(rows(db, 'organization_memberships')).toEqual([
      { id: 'staff-a', account_id: 'staff-a', organization_id: 'org-a', legacy_member_id: 'staff-a', status: 'active', created_at: 11 },
      { id: 'staff-b', account_id: 'staff-b', organization_id: 'org-b', legacy_member_id: 'staff-b', status: 'inactive', created_at: 21 },
    ]);
    expect(rows(db, 'organization_membership_roles')).toEqual([{ membership_id: 'staff-a', role: 'doctor' }, { membership_id: 'staff-b', role: 'admin' }]);
    expect(rows(db, 'external_identities')).toEqual([]);
    const snapshot = projection(db), history = rows(db, 'schema_migrations');
    expect(migrate(db, identityMigrations()).applied).toEqual([]);
    expect(projection(db)).toEqual(snapshot);
    expect(rows(db, 'schema_migrations')).toEqual(history);
    migrate(db); // Current services require the current schema; prefix assertions above remain immutable.
    const dir = new ClinicDirectory(db);
    expect(dir.authenticate('a'.repeat(43))).toEqual({ memberId: 'staff-a', orgId: 'org-a', role: 'doctor' });
    expect(dir.authenticate('b'.repeat(43))).toBeNull();
    db.close();
  });

  for (const corruption of ['role', 'organization'] as const) it(`invalid legacy ${corruption} refuses migration 2 without partial DDL or data repair`, () => {
    const db = baseline();
    if (corruption === 'role') db.exec("UPDATE clinic_members SET role = 'superuser' WHERE id = 'staff-a'");
    else db.exec("UPDATE clinic_members SET org = 'missing' WHERE id = 'staff-a'");
    const before = rows(db, 'clinic_members');
    expect(() => migrate(db, identityMigrations())).toThrow(/migration_failed/);
    expect(db.isTransaction).toBe(false);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'accounts'").get()).toBeUndefined();
    expect(rows(db, 'clinic_members')).toEqual(before);
    expect(rows(db, 'schema_migrations')).toHaveLength(1);
    db.close();
  });
});

describe('identity constraints and legacy authority', () => {
  it('expresses multiple clinic memberships and role sets without granting legacy token extra permissions', () => {
    const { store, db, dir, doctor } = rig();
    const member = rows(db, 'organization_memberships').find((r) => r.id === doctor.memberId)!;
    const accountId = member.account_id as string;
    db.prepare('INSERT INTO organization_membership_roles VALUES (?, ?)').run(doctor.memberId, 'admin');
    expect(() => db.prepare('INSERT INTO organization_membership_roles VALUES (?, ?)').run(doctor.memberId, 'admin')).toThrow();
    expect(() => db.prepare('INSERT INTO organization_membership_roles VALUES (?, ?)').run(doctor.memberId, 'superuser')).toThrow();
    const other = dir.createOrganization('Other clinic', 'Other admin');
    db.prepare('INSERT INTO organization_memberships VALUES (?, ?, ?, NULL, ?, ?)').run('other-membership', accountId, other.orgId, 'active', 1);
    expect(() => db.prepare('INSERT INTO organization_memberships VALUES (?, ?, ?, NULL, ?, ?)').run('duplicate', accountId, other.orgId, 'active', 1)).toThrow();
    expect(() => db.prepare('INSERT INTO organization_membership_roles VALUES (?, ?)').run('missing', 'doctor')).toThrow();
    expect(() => db.prepare('INSERT INTO organization_memberships VALUES (?, ?, ?, NULL, ?, ?)').run('bad', 'missing-account', other.orgId, 'active', 1)).toThrow();
    const actor = dir.authenticate(doctor.token)!;
    expect(actor.role).toBe('doctor');
    expect(() => dir.require(actor, 'staff.manage')).toThrow('forbidden');
    store.close();
  });

  it('keys external identity by exact issuer + subject, with no implicit email/name match', () => {
    const { store, db, doctor, org } = rig();
    const insert = db.prepare('INSERT INTO external_identities VALUES (?, ?, ?, ?)');
    insert.run('issuer-a', 'same-subject', doctor.memberId, 1);
    insert.run('issuer-b', 'same-subject', doctor.memberId, 1);
    expect(() => insert.run('issuer-a', 'same-subject', org.adminId, 1)).toThrow();
    expect(() => insert.run('issuer-a', '', doctor.memberId, 1)).toThrow();
    expect(() => insert.run('issuer-a', 'other', 'missing', 1)).toThrow();
    expect(rows(db, 'accounts').every((r) => r.status === 'pending_link')).toBe(true);
    store.close();
  });
});

describe('transactional legacy projection', () => {
  it('projects operator/admin/staff creation, replaces a legacy role, preserves role history on deactivation', () => {
    const { store, db, dir, admin, doctor } = rig();
    expect(rows(db, 'accounts')).toHaveLength(2);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    db.prepare('INSERT INTO organization_membership_roles VALUES (?, ?)').run(doctor.memberId, 'admin');
    dir.setRole(admin, doctor.memberId, 'admin');
    expect(db.prepare('SELECT role FROM organization_membership_roles WHERE membership_id = ?').all(doctor.memberId)).toEqual([{ role: 'admin' }]);
    db.prepare('INSERT INTO organization_membership_roles VALUES (?, ?)').run(doctor.memberId, 'doctor');
    dir.deactivate(admin, doctor.memberId);
    expect(db.prepare('SELECT status FROM organization_memberships WHERE id = ?').get(doctor.memberId)).toEqual({ status: 'inactive' });
    expect(db.prepare('SELECT role FROM organization_membership_roles WHERE membership_id = ? ORDER BY role').all(doctor.memberId)).toEqual([{ role: 'admin' }, { role: 'doctor' }]);
    expect(db.prepare('SELECT status FROM accounts WHERE id = ?').get(doctor.memberId)).toEqual({ status: 'pending_link' });
    expect(dir.authenticate(doctor.token)).toBeNull();
    expect(() => projectLegacyMember(db, doctor.memberId)).toThrow('requires the legacy transaction');
    store.close();
  });

  for (const operation of ['create', 'add', 'role', 'deactivate'] as const) it(`${operation}: failed audit rolls back legacy row, account, membership and roles together`, () => {
    const { store, db, dir, admin, doctor } = rig();
    const before = projection(db);
    db.exec("CREATE TEMP TRIGGER audit_failure BEFORE INSERT ON main.clinic_audit BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END");
    expect(() => {
      if (operation === 'create') dir.createOrganization('New clinic', 'New admin');
      else if (operation === 'add') dir.addStaff(admin, { displayName: 'New doctor', role: 'doctor' });
      else if (operation === 'role') dir.setRole(admin, doctor.memberId, 'admin');
      else dir.deactivate(admin, doctor.memberId);
    }).toThrow('injected audit failure');
    expect(projection(db)).toEqual(before);
    expect(db.isTransaction).toBe(false);
    store.close();
  });
});
