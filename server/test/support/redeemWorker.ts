// A separate thread with its own SQLite connection, for redeem concurrency tests (ACCESS-00-H, AC-21).
// Roles:
//   hold   — takes the write lock (BEGIN IMMEDIATE) and keeps it for `holdMs`, then rolls back.
//   slow   — redeems while pausing for `holdMs` after the status change, holding the lock; `rollback` throws there.
//   http   — redeems through the real HTTP handler; waits for the shared `go` flag before sending.
//   domain — like http, but calls PlanDelivery.redeem directly.
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { createApp } from '../../src/app.ts';
import { ClinicDirectory } from '../../src/clinic/directory.ts';
import { PlanDelivery, RedeemFailure } from '../../src/clinic/delivery.ts';
import { DatabaseBusy } from '../../src/clinic/tx.ts';
import { Store } from '../../src/store.ts';

interface Data { role: 'hold' | 'slow' | 'http' | 'domain'; path: string; code?: string; holdMs?: number; rollback?: boolean; sab: SharedArrayBuffer }
const d = workerData as Data;
const flags = new Int32Array(d.sab); // [0] go
const post = (m: unknown) => parentPort!.postMessage(m);
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const waitGo = () => { while (Atomics.load(flags, 0) === 0) Atomics.wait(flags, 0, 0, 1000); };

if (d.role === 'hold') {
  const db = new DatabaseSync(d.path);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('BEGIN IMMEDIATE');
  post({ type: 'locked' });
  sleep(d.holdMs!);
  db.exec('ROLLBACK');
  db.close();
  post({ type: 'done' });
} else if (d.role === 'slow') {
  const store = new Store(d.path);
  const dir = new ClinicDirectory(store.database);
  const del = new PlanDelivery(store.database, dir, Date.now, (step) => {
    if (step !== 'transition') return;
    post({ type: 'locked' });
    sleep(d.holdMs!);
    if (d.rollback) throw new Error('injected fault');
  });
  let result: unknown;
  try { result = { ok: del.redeem(d.code!).title }; } catch (e) { result = { error: e instanceof RedeemFailure ? e.code : (e as Error).message }; }
  store.close();
  post({ type: 'done', result });
} else {
  const store = new Store(d.path);
  const dir = new ClinicDirectory(store.database);
  const del = new PlanDelivery(store.database, dir);
  const app = createApp({ store, origins: [], planDelivery: del });
  post({ type: 'ready' });
  waitGo();
  const t0 = performance.now();
  if (d.role === 'domain') {
    let result: unknown;
    try { result = { ok: del.redeem(d.code!).title }; } catch (e) {
      result = { error: e instanceof RedeemFailure ? e.code : e instanceof DatabaseBusy ? 'database_busy' : (e as Error).message };
    }
    post({ type: 'done', result, ms: performance.now() - t0 });
  } else {
    const r = await app.request('/v1/clinic/plans/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: d.code }),
    });
    const ms = performance.now() - t0;
    post({ type: 'done', result: { status: r.status, retryAfter: r.headers.get('retry-after'), body: await r.json() }, ms });
  }
  store.close();
}
