import { parentPort, workerData } from 'node:worker_threads';
import { Store } from '../../src/store.ts';
import { ClinicDirectory } from '../../src/clinic/directory.ts';
import { StaffInvitations } from '../../src/clinic/invitations.ts';
const d = workerData as { path: string; sessionHash: string; secret: string; flags: SharedArrayBuffer };
const store = new Store(d.path), flags = new Int32Array(d.flags);
parentPort!.postMessage('ready');
while (Atomics.load(flags,0) === 0) Atomics.wait(flags,0,0,1000);
try { parentPort!.postMessage({ ok: true, result: new StaffInvitations(store.database, new ClinicDirectory(store.database), 'https://app.test').accept(d.sessionHash, d.secret) }); }
catch (e) { parentPort!.postMessage({ ok: false, error: (e as Error).message }); }
finally { store.close(); }
