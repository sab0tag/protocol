import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { ClinicDirectory } from '../src/clinic/directory.ts';
import { PlanDelivery } from '../src/clinic/delivery.ts';
import { Sessions } from '../src/identity/sessions.ts';
import { Store } from '../src/store.ts';

for (const operation of ['issue', 'revoke', 'add', 'role', 'deactivate', 'rotate', 'credential-rotation']) {
  it(`rechecks ${operation} authority after another connection commits ${operation === 'credential-rotation' ? 'credential rotation' : 'account disable'}`, async () => {
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
      const clinical = operation === 'issue' || operation === 'revoke';
      const memberId = clinical ? doctor.memberId : org.adminId;
      const flags = new SharedArrayBuffer(4);
      worker = new Worker(new URL('./support/policyWorker.ts', import.meta.url), { execArgv: [], workerData: {
        path, operation: operation === 'credential-rotation' ? 'add' : operation, token: clinical ? doctor.token : org.token,
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
      if (operation === 'credential-rotation') db.prepare('UPDATE clinic_members SET token_hash = lower(hex(randomblob(32))) WHERE id = ?').run(memberId);
      else db.prepare("UPDATE accounts SET status = 'disabled' WHERE id = ?").run(memberId);
      const snapshot = () => ['clinic_members', 'organization_memberships', 'organization_membership_roles', 'plan_delivery', 'clinic_audit']
        .map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
      const before = snapshot();
      Atomics.store(new Int32Array(flags), 0, 1); Atomics.notify(new Int32Array(flags), 0);
      // The worker now attempts BEGIN while the other connection holds the write lock.
      await new Promise((resolve) => setTimeout(resolve, 150));
      db.exec('COMMIT');
      expect(await next()).toBe('unauthenticated');
      expect(await done).toBe(0);
      expect(snapshot()).toEqual(before);
    } finally {
      if (db.isTransaction) db.exec('ROLLBACK');
      await worker?.terminate(); store.close(); rmSync(folder, { recursive: true, force: true });
    }
  }, 15_000);
}

it('rechecks a session revocation committed while plan issue waits for the write lock', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'protocol-session-policy-')), path = join(folder, 'db.sqlite');
  const store = Store.migrated(path), db = store.database, dir = new ClinicDirectory(db);
  let worker: Worker | undefined;
  try {
    const org = dir.createOrganization('Synthetic', 'Admin'), doctor = dir.addStaff(dir.authenticate(org.token)!, { displayName: 'Doctor', role: 'doctor' });
    db.prepare("UPDATE accounts SET status = 'active' WHERE id = ?").run(doctor.memberId);
    db.prepare('INSERT INTO external_identities VALUES (?, ?, ?, ?)').run('https://issuer.test/', 'doctor', doctor.memberId, Date.now());
    const signed = new Sessions(db).signIn({ issuer: 'https://issuer.test/', subject: 'doctor', authTime: Date.now(), mfa: true, replacing: null });
    if (typeof signed === 'string') throw Error(signed);
    const flags = new SharedArrayBuffer(4);
    worker = new Worker(new URL('./support/policyWorker.ts', import.meta.url), { execArgv: [], workerData: { path, operation: 'issue', token: signed.token, sessionOrg: org.orgId, target: '', flags,
      plan: { schemaVersion: 1, planId: crypto.randomUUID(), organizationId: org.orgId, issuedAt: '2026-10-29T12:00:00Z', clinician: { displayName: 'Doctor', organizationName: 'Synthetic' }, title: 'Synthetic', medications: [], restrictions: [], tests: [] } } });
    const queue: string[] = [], readers: ((s: string) => void)[] = [];
    worker.on('message', (s: string) => { const reader = readers.shift(); if (reader) reader(s); else queue.push(s); });
    const next = () => new Promise<string>((resolve, reject) => { const s = queue.shift(); if (s) resolve(s); else readers.push(resolve); worker!.once('error', reject); });
    const done = new Promise<number>((resolve, reject) => { worker!.once('exit', resolve); worker!.once('error', reject); });
    expect(await next()).toBe('ready'); expect(await next()).toBe('preflight');
    db.exec('BEGIN IMMEDIATE'); db.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?').run(Date.now(), signed.session.hash);
    const before = db.prepare('SELECT * FROM clinic_audit').all();
    Atomics.store(new Int32Array(flags), 0, 1); Atomics.notify(new Int32Array(flags), 0);
    await new Promise(resolve => setTimeout(resolve, 150)); db.exec('COMMIT');
    expect(await next()).toBe('unauthorized'); expect(await done).toBe(0);
    expect(db.prepare('SELECT * FROM plan_delivery').all()).toHaveLength(0); expect(db.prepare('SELECT * FROM clinic_audit').all()).toEqual(before);
  } finally { if (db.isTransaction) db.exec('ROLLBACK'); await worker?.terminate(); store.close(); rmSync(folder, { recursive: true, force: true }); }
}, 15_000);
