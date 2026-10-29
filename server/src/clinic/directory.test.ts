import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../db/migrate.ts';
import { describe, expect, it } from 'vitest';
import { ClinicDirectory, ClinicError, type Actor } from './directory.ts';
import { can } from './roles.ts';

const rig = () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const dir = new ClinicDirectory(db);
  const a = dir.createOrganization('Клініка А', 'Адмін А');
  const b = dir.createOrganization('Клініка Б', 'Адмін Б');
  const adminA = dir.authenticate(a.token)!, adminB = dir.authenticate(b.token)!;
  return { dir, a, b, adminA, adminB };
};
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as ClinicError).code; } return 'ok'; };

describe('roles', () => {
  it('admins manage staff but do not write plans; doctors write plans but do not manage staff', () => {
    expect(can('admin', 'staff.manage')).toBe(true);
    expect(can('admin', 'plan.create')).toBe(false);
    expect(can('doctor', 'plan.issue')).toBe(true);
    expect(can('doctor', 'staff.manage')).toBe(false);
    expect(can('doctor', 'subscription.manage')).toBe(false);
  });
});

describe('authentication', () => {
  it('knows a token only by its hash and rejects unknown ones', () => {
    const { dir, a } = rig();
    expect(dir.authenticate(a.token)).toMatchObject({ orgId: a.orgId, role: 'admin' });
    expect(dir.authenticate('nope')).toBeNull();
    expect(dir.authenticate(undefined)).toBeNull();
    const rows = (dir as unknown as { db: DatabaseSync }).db.prepare('SELECT token_hash FROM clinic_members').all() as { token_hash: string }[];
    expect(rows.some((r) => r.token_hash === a.token)).toBe(false);
  });

  it('deactivation cuts access at once, even for an actor object already in hand', () => {
    const { dir, adminA } = rig();
    const d = dir.addStaff(adminA, { displayName: 'Лікар', role: 'doctor' });
    const doctor = dir.authenticate(d.token)!;
    expect(code(() => dir.require(doctor, 'plan.create'))).toBe('ok');
    dir.deactivate(adminA, d.memberId);
    expect(dir.authenticate(d.token)).toBeNull();
    expect(code(() => dir.require(doctor, 'plan.create'))).toBe('unauthenticated');
  });

  it('a rotated token replaces the old one', () => {
    const { dir, adminA } = rig();
    const d = dir.addStaff(adminA, { displayName: 'Лікар', role: 'doctor' });
    const fresh = dir.rotateToken(adminA, d.memberId);
    expect(dir.authenticate(d.token)).toBeNull();
    expect(dir.authenticate(fresh)).not.toBeNull();
  });
});

describe('privilege escalation', () => {
  it('a doctor cannot add staff, change roles, rotate tokens or read the audit', () => {
    const { dir, adminA } = rig();
    const d = dir.addStaff(adminA, { displayName: 'Лікар', role: 'doctor' });
    const doctor = dir.authenticate(d.token)!;
    expect(code(() => dir.addStaff(doctor, { displayName: 'X', role: 'admin' }))).toBe('forbidden');
    expect(code(() => dir.setRole(doctor, d.memberId, 'admin'))).toBe('forbidden');
    expect(code(() => dir.rotateToken(doctor, adminA.memberId))).toBe('forbidden');
    expect(code(() => dir.auditLog(doctor))).toBe('forbidden');
    expect(dir.authenticate(d.token)!.role).toBe('doctor');
  });

  it('a forged actor with a stale role is re-checked against the database', () => {
    const { dir, adminA } = rig();
    const d = dir.addStaff(adminA, { displayName: 'Лікар', role: 'doctor' });
    const forged: Actor = { memberId: d.memberId, orgId: adminA.orgId, role: 'admin' };
    expect(code(() => dir.addStaff(forged, { displayName: 'X', role: 'admin' }))).toBe('forbidden');
  });
});

describe('tenant isolation (IDOR)', () => {
  it('another clinic\'s member ids do not exist for the caller', () => {
    const { dir, adminA, adminB } = rig();
    const victim = dir.listStaff(adminB)[0]!;
    expect(code(() => dir.deactivate(adminA, victim.id))).toBe('not_found');
    expect(code(() => dir.setRole(adminA, victim.id, 'doctor'))).toBe('not_found');
    expect(code(() => dir.rotateToken(adminA, victim.id))).toBe('not_found');
    expect(dir.listStaff(adminB)[0]).toMatchObject({ active: true, role: 'admin' });
  });

  it('lists and audits only its own organization; a swapped orgId cannot reach another tenant', () => {
    const { dir, adminA, adminB } = rig();
    dir.addStaff(adminA, { displayName: 'Лікар А', role: 'doctor' });
    expect(dir.listStaff(adminA)).toHaveLength(2);
    expect(dir.listStaff(adminB)).toHaveLength(1);
    expect(dir.auditLog(adminB).every((e) => e.actor === adminB.memberId)).toBe(true);
    const swapped: Actor = { ...adminA, orgId: adminB.orgId };
    expect(code(() => dir.listStaff(swapped))).toBe('unauthenticated');
  });
});

describe('admin safety and audit', () => {
  it('the last active admin cannot be removed or demoted', () => {
    const { dir, adminA } = rig();
    expect(code(() => dir.deactivate(adminA, adminA.memberId))).toBe('last_admin');
    expect(code(() => dir.setRole(adminA, adminA.memberId, 'doctor'))).toBe('last_admin');
    const second = dir.addStaff(adminA, { displayName: 'Другий', role: 'admin' });
    dir.deactivate(adminA, second.memberId);
    expect(dir.authenticate(second.token)).toBeNull();
  });

  it('writes who did what to which id, with no free text', () => {
    const { dir, adminA } = rig();
    const d = dir.addStaff(adminA, { displayName: 'Лікар Іваненко', role: 'doctor' });
    dir.deactivate(adminA, d.memberId);
    const log = dir.auditLog(adminA);
    expect(log.map((e) => e.action)).toEqual(['staff.deactivate', 'staff.add', 'org.create']);
    expect(JSON.stringify(log)).not.toContain('Іваненко');
  });

  it('rejects empty or oversized names', () => {
    const { dir, adminA } = rig();
    expect(code(() => dir.addStaff(adminA, { displayName: '  ', role: 'doctor' }))).toBe('bad_request');
    expect(code(() => dir.createOrganization('x'.repeat(201), 'a'))).toBe('bad_request');
    expect(code(() => dir.addStaff(adminA, { displayName: 'A', role: 'owner' as never }))).toBe('bad_request');
  });
});
