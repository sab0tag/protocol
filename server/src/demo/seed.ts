// Demo stand only: «Демо-клініка» with an administrator, an endocrinologist and a traumatologist (who also prescribes ЛФК),
// each linked to the demo identity provider's subject, ready to sign in with its second step. No patient exists here:
// a patient is any clean phone that redeems a code (ТЗ «демо клиники», «Пациент»).
import { existsSync, rmSync } from 'node:fs';
import { ClinicDirectory } from '../clinic/directory.ts';
import { Store } from '../store.ts';
import { DemoGuardError } from './guard.ts';
import { DEMO_STAFF } from './idp.ts';

export const DEMO_CLINIC = 'Демо-клініка';

export function seedDemo(store: Store, issuer: string): { orgId: string; staff: { subject: string; memberId: string }[] } {
  const dir = new ClinicDirectory(store.database);
  const [admin, endo, trauma] = DEMO_STAFF;
  const org = dir.createOrganization(DEMO_CLINIC, admin.name);
  const actor = dir.authenticate(org.token)!;
  const staff = [{ subject: admin.subject, memberId: org.adminId },
    { subject: endo.subject, memberId: dir.addStaff(actor, { displayName: endo.name, role: 'doctor' }).memberId },
    { subject: trauma.subject, memberId: dir.addStaff(actor, { displayName: trauma.name, role: 'doctor' }).memberId }];
  const now = Date.now();
  for (const s of staff) {
    store.database.prepare("UPDATE accounts SET status = 'active' WHERE id = ?").run(s.memberId);
    store.database.prepare('INSERT INTO external_identities VALUES (?, ?, ?, ?)').run(issuer, s.subject, s.memberId, now);
  }
  return { orgId: org.orgId, staff };
}

/** `npm run demo:reset`: the database from scratch (every code issued before is gone with it), migrated, seeded. Run with
 *  the API stopped (demo/reset.sh does it). Refuses outside DEMO=1. */
export function demoReset(env: Record<string, string | undefined>): ReturnType<typeof seedDemo> {
  if (env.DEMO !== '1') throw new DemoGuardError('demo:reset runs only with DEMO=1');
  const path = env.DB_PATH, issuer = env.OIDC_ISSUER;
  if (!path || !issuer) throw new DemoGuardError('DB_PATH and OIDC_ISSUER are required');
  for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) rmSync(f);
  const store = Store.migrated(path);
  try { return seedDemo(store, issuer); } finally { store.close(); }
}

if (import.meta.main) {
  try {
    const r = demoReset(process.env);
    console.log(`demo reset: «${DEMO_CLINIC}» with ${r.staff.length} staff; old codes are gone with the old database`);
  } catch (e) { console.error(`demo reset refused: ${(e as Error).message}`); process.exit(1); }
}
