import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { ClinicDirectory } from '../src/clinic/directory.ts';
import { PlanDelivery } from '../src/clinic/delivery.ts';
import { Store } from '../src/store.ts';

// AC-21: independent connections to one file database, each in its own thread. Promise.all around synchronous
// node:sqlite in one event loop would not prove anything; real threads with a shared flag do.

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'protocol-redeem-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite');
  const store = new Store(path);
  const clinic = new ClinicDirectory(store.database);
  const delivery = new PlanDelivery(store.database, clinic);
  const org = clinic.createOrganization('Клініка', 'Адмін');
  const admin = clinic.authenticate(org.token)!;
  const doc = clinic.authenticate(clinic.addStaff(admin, { displayName: 'Лікар', role: 'doctor' }).token)!;
  const { code } = delivery.issue(doc, { plan: { schemaVersion: 1, planId: crypto.randomUUID(), organizationId: org.orgId,
    issuedAt: '2026-10-01T10:00:00+03:00', clinician: { displayName: 'Лікар', organizationName: 'Клініка' }, title: 'План',
    medications: [], restrictions: [], tests: [] }, patientConsent: true });
  const sab = new SharedArrayBuffer(4);
  const go = () => { const f = new Int32Array(sab); Atomics.store(f, 0, 1); Atomics.notify(f, 0); };
  const row = () => store.database.prepare('SELECT status, plan IS NULL AS erased FROM plan_delivery').get() as { status: string; erased: number };
  const audit = () => clinic.auditLog(admin).filter((e) => e.actor === 'patient_link').map((e) => e.action);
  return { path, code, sab, go, row, audit, delivery, store };
}

type Msg = { type: string; result?: any; ms?: number };
function spawn(data: Record<string, unknown>) {
  const w = new Worker(new URL('./support/redeemWorker.ts', import.meta.url), { workerData: data, execArgv: [] });
  const queue: Msg[] = [], waiters: ((m: Msg) => void)[] = [];
  const exited = new Promise<number>((r) => w.once('exit', r)); // subscribed now: a fast worker may exit before we await
  let failure: Error | undefined;
  w.on('message', (m: Msg) => { const r = waiters.shift(); if (r) r(m); else queue.push(m); });
  w.on('error', (e: Error) => { failure = e; });
  const next = (type: string) => new Promise<Msg>((resolve, reject) => {
    const take = (m: Msg) => (m.type === type ? resolve(m) : reject(new Error(`expected ${type}, got ${m.type}`)));
    if (failure) return reject(failure);
    const m = queue.shift();
    if (m) take(m); else waiters.push(take);
    w.once('error', reject);
  });
  return { next, done: () => exited };
}

describe('redeem across independent connections', () => {
  it('the second redemption waits for the lock, then gets used/409; one plan leaves, one audit entry', async () => {
    const s = setup();
    const http = spawn({ role: 'http', path: s.path, code: s.code, sab: s.sab });
    await http.next('ready');
    const slow = spawn({ role: 'slow', path: s.path, code: s.code, holdMs: 700, sab: s.sab });
    await slow.next('locked');
    s.go();
    const [first, second] = await Promise.all([slow.next('done'), http.next('done')]);
    expect(first.result).toEqual({ ok: 'План' });
    expect(second.result).toMatchObject({ status: 409, body: { error: 'used' } });
    expect(second.ms!).toBeGreaterThan(200); // it really waited for the lock
    expect(second.ms!).toBeLessThan(5000);
    expect(s.row()).toEqual({ status: 'redeemed', erased: 1 });
    expect(s.audit()).toEqual(['plan.redeem']);
    await Promise.all([slow.done(), http.done()]);
  }, 20_000);

  it('when the first transaction rolls back, the waiting one may legitimately succeed', async () => {
    const s = setup();
    const http = spawn({ role: 'http', path: s.path, code: s.code, sab: s.sab });
    await http.next('ready');
    const slow = spawn({ role: 'slow', path: s.path, code: s.code, holdMs: 700, rollback: true, sab: s.sab });
    await slow.next('locked');
    s.go();
    const [first, second] = await Promise.all([slow.next('done'), http.next('done')]);
    expect(first.result).toEqual({ error: 'injected fault' });
    expect(second.result).toMatchObject({ status: 200, body: { plan: { title: 'План' } } });
    expect(s.row()).toEqual({ status: 'redeemed', erased: 1 });
    expect(s.audit()).toEqual(['plan.redeem']);
    await Promise.all([slow.done(), http.done()]);
  }, 20_000);

  it('a lock held past busy_timeout gives database_busy/503 with Retry-After, and the delivery is untouched', async () => {
    const s = setup();
    const http = spawn({ role: 'http', path: s.path, code: s.code, sab: s.sab });
    const domain = spawn({ role: 'domain', path: s.path, code: s.code, sab: s.sab });
    await Promise.all([http.next('ready'), domain.next('ready')]);
    const hold = spawn({ role: 'hold', path: s.path, holdMs: 6_500, sab: s.sab });
    await hold.next('locked');
    s.go();
    const [viaHttp, direct] = await Promise.all([http.next('done'), domain.next('done')]);
    expect(viaHttp.result).toEqual({ status: 503, retryAfter: '1', body: { error: 'database_busy' } });
    expect(direct.result).toEqual({ error: 'database_busy' });
    for (const r of [viaHttp, direct]) {
      expect(r.ms!).toBeGreaterThan(4_800); // the API connection really waits busy_timeout = 5000
      expect(r.ms!).toBeLessThan(6_400);
    }
    await hold.next('done');
    expect(s.row()).toEqual({ status: 'pending', erased: 0 });
    expect(s.audit()).toEqual([]);
    expect(s.delivery.redeem(s.code).title).toBe('План'); // the retry after the lock is released succeeds
    await Promise.all([http.done(), domain.done(), hold.done()]);
  }, 30_000);
});
