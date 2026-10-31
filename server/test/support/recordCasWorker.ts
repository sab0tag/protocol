import { parentPort, workerData } from 'node:worker_threads';
import { Store, RecordWriteError } from '../../src/store.ts';
const data = workerData as { path: string; vault: string; record: { k: string; v: string }; flags: SharedArrayBuffer };
const store = new Store(data.path), flags = new Int32Array(data.flags);
parentPort!.postMessage({ ready: true });
while (Atomics.load(flags, 0) === 0) Atomics.wait(flags, 0, 0, 1000);
try { parentPort!.postMessage({ ok: true, seq: store.put(data.vault, [data.record], { protocol: 2, expectedSeq: 0 }) }); }
catch (e) { parentPort!.postMessage({ ok: false, code: e instanceof RecordWriteError ? e.code : (e as Error).message }); }
finally { store.close(); }
