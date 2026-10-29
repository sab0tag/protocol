import { parentPort, workerData } from 'node:worker_threads';
import { ClinicDirectory } from '../../src/clinic/directory.ts';
import { PlanDelivery } from '../../src/clinic/delivery.ts';
import { Store } from '../../src/store.ts';

const d = workerData as { path: string; token: string; operation: string; target: string; plan: unknown; flags: SharedArrayBuffer };
const store = new Store(d.path), dir = new ClinicDirectory(store.database);
const actor = dir.authenticate(d.token)!;
const delivery = new PlanDelivery(store.database, dir);
const require = dir.require.bind(dir);
let first = true;
dir.require = (...args) => {
  require(...args);
  if (!first) return;
  first = false;
  parentPort!.postMessage('preflight');
  const flags = new Int32Array(d.flags);
  while (Atomics.load(flags, 0) === 0) Atomics.wait(flags, 0, 0, 1000);
};
parentPort!.postMessage('ready');
try {
  switch (d.operation) {
    case 'issue': delivery.issue(actor, { plan: d.plan, patientConsent: true }); break;
    case 'revoke': delivery.revoke(actor, d.target); break;
    case 'add': dir.addStaff(actor, { displayName: 'Forbidden new staff', role: 'doctor' }); break;
    case 'role': dir.setRole(actor, d.target, 'admin'); break;
    case 'deactivate': dir.deactivate(actor, d.target); break;
    case 'rotate': dir.rotateToken(actor, d.target); break;
    default: throw new Error('unknown operation');
  }
  parentPort!.postMessage('unexpected success');
} catch (e) { parentPort!.postMessage((e as Error).message); }
finally { store.close(); }
