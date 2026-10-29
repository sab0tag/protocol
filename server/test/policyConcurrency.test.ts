import { Sessions } from '../src/identity/sessions.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { ClinicDirectory } from '../src/clinic/directory.ts';
import { PlanDelivery } from '../src/clinic/delivery.ts';
import { Store } from '../src/store.ts';

for (const operation of ['issue', 'revoke', 'add', 'role', 'deactivate', 'rotate', 'session-issue']) {
  it(`rechecks ${operation} authority after another connection commits revocation`, async () => {
    const folder = mkdtempSync(join(tmpdir(), 'protocol-policy-')), path = join(folder, 'db.sqlite');
    const store = Store.migrated(path), db = store.database, dir = new ClinicDirectory(db);
    let worker: Worker | undefined;
    try {
      const org = dir.createOrganization('Synthetic', 'Admin'), admin = dir.authenticate(org.token)!;
      const doctor = dir.addStaff(admin, { displayName: 'Doctor', role: 'doctor' });
      const actor = dir.authenticate(doctor.token)!;
      const plan = { schemaVersion: 1, planId: crypto.randomUUID(), organizationId: org.orgId,
        issuedAt: '2026-10-29T12:00:00Z', clinician: { displayName: 'Doctor', organizationName: 'Synthetic' },
        title: 'Synthetic', medications: [], restrictions: [], tests: [] };
      const delivery = new PlanDelivery(db, dir).issue(actor, { plan, patientConsent: true });
      const clinical = operation === 'issue' || operation === 'revoke' || operation === 'session-issue';
      let sessionHash: string | undefined;
      if (operation === 'session-issue') {
        const established = new Sessions(db).establish({ issuer: 'https://issuer.invalid/', subject: 'synthetic', authTime: Date.now(), mfa: true }, null);
        db.prepare('UPDATE organization_memberships SET account_id = ? WHERE id = ?').run(established.session.account_id, doctor.memberId);
        sessionHash = established.session.id_hash;
      }
      const memberId = clinical ? doctor.memberId : org.adminId;
      const flags = new SharedArrayBuffer(4);
      worker = new Worker(new URL('./support/policyWorker.ts', import.meta.url), { execArgv: [], workerData: {
        path, operation: operation === 'session-issue' ? 'issue' : operation, sessionHash, orgId: org.orgId, token: clinical ? doctor.token : org.token,
        target: operation === 'revoke' ? delivery.deliveryId : doctor.memberId, plan, flags,
      } });
      const messages: string[] = [], readers: ((s: string) => void)[] = [];
      worker.on('message', (s: string) => { const reader = readers.shift(); if (reader) reader(s); else messages.push(s); });
      const next = () => new Promise<string>((resolve, reject) => {
        const s = messages.shift(); if (s) resolve(s); else readers.push(resolve);
        worker!.once('error', reject);
      });
      const done = new Promise<number>((resolve, reject) => { worker!.once('exit', resolve); worker!.once('error', reject); });
      expect(await next()).toBe('ready');
      expect(await next()).toBe('preflight'); // cached actor + outside-transaction policy already passed
      db.exec('BEGIN IMMEDIATE');
      if (sessionHash) db.prepare('UPDATE identity_sessions SET revoked_at = ? WHERE id_hash = ?').run(Date.now(), sessionHash);
      else db.prepare("UPDATE accounts SET status = 'disabled' WHERE id = ?").run(memberId);
      const snapshot = () => ['clinic_members', 'organization_memberships', 'organization_membership_roles', 'plan_delivery', 'clinic_audit']
        .map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
      const before = snapshot();
      Atomics.store(new Int32Array(flags), 0, 1); Atomics.notify(new Int32Array(flags), 0);
      // The worker now attempts BEGIN while the other connection holds the write lock.
      await new Promise((resolve) => setTimeout(resolve, 150));
      db.exec('COMMIT');
      expect(await next()).toBe(sessionHash ? 'unauthorized' : 'unauthenticated');
      expect(await done).toBe(0);
      expect(snapshot()).toEqual(before);
    } finally {
      if (db.isTransaction) db.exec('ROLLBACK');
      await worker?.terminate(); store.close(); rmSync(folder, { recursive: true, force: true });
    }
  }, 15_000);
}
