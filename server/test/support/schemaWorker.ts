// A separate thread with its own SQLite connection, for runner and CLI concurrency tests (ACCESS-00-M, AC-22, AC-25).
// Roles: migrate — runs the bundled migrations; create — runs the clinic:create command. Both wait for the shared flag.
import { parentPort, workerData } from 'node:worker_threads';
import { createOrg } from '../../src/clinic/createOrg.ts';
import { migrate } from '../../src/db/migrate.ts';
import { Store } from '../../src/store.ts';

const d = workerData as { role: 'migrate' | 'create'; path: string; name?: string; sab: SharedArrayBuffer };
const flags = new Int32Array(d.sab);
parentPort!.postMessage({ type: 'ready' });
while (Atomics.load(flags, 0) === 0) Atomics.wait(flags, 0, 0, 1000);

if (d.role === 'migrate') {
  const store = new Store(d.path);
  try { parentPort!.postMessage({ type: 'done', result: migrate(store.database) }); } catch (e) {
    parentPort!.postMessage({ type: 'done', error: (e as Error).message });
  } finally { store.close(); }
} else {
  const out: string[] = [], err: string[] = [];
  const code = createOrg([d.name!, 'Адмін'], d.path, (s) => out.push(s), (s) => err.push(s));
  parentPort!.postMessage({ type: 'done', result: { code, out: out.join('\n'), err: err.join('\n') } });
}
