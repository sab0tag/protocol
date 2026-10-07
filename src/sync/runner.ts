// When to sync (D31): on start, when the app comes back to the screen or online, a few seconds after any change,
// and every two minutes while open. One round at a time; a request during a round runs another after it.
import Dexie from 'dexie';
import { create } from 'zustand';
import { db } from '../data/db';
import { ApiError, createVault, putPair, takePair, vaultApi } from './api';
import { deriveKeys, newPairCode, pairId, parseCode, parsePairCode, sealForPairing, type Keys } from './crypto';
import { syncOnce } from './engine';
import { disablePush, pushSchedule, renewPush } from './push';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

interface SyncState { status: SyncStatus; lastAt?: number; error?: string }
export const useSync = create<SyncState>(() => ({ status: 'off' }));

let keys: Keys | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false, again = false, wired = false;

export const currentKeys = () => keys;

export function requestSync(delay = 0) {
  if (!keys) return;
  clearTimeout(timer);
  timer = setTimeout(() => void run(), delay);
}

async function run() {
  if (!keys) return;
  if (running) { again = true; return; }
  running = true;
  useSync.setState({ status: 'syncing' });
  try {
    await syncOnce(db, keys, vaultApi(keys));
    useSync.setState({ status: 'idle', lastAt: Date.now(), error: undefined });
    await pushSchedule(keys).catch((e) => console.warn('reminders:', (e as Error).message)); // D34
  } catch (e) {
    const offline = e instanceof ApiError && e.status === 0;
    useSync.setState({ status: offline ? 'offline' : 'error', error: e instanceof ApiError ? e.code : (e as Error).message });
  } finally {
    running = false;
    if (again) { again = false; requestSync(1000); }
  }
}

function wire() {
  if (wired) return;
  wired = true;
  Dexie.on('storagemutated', () => { if (running) again = true; else requestSync(3000); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestSync(); });
  window.addEventListener('online', () => requestSync());
  setInterval(() => { if (document.visibilityState === 'visible') requestSync(); }, 120_000);
}

/** On app start: resume if this device has a code. */
export async function startSync() {
  const meta = await db.meta.get('sync');
  const bytes = meta && parseCode(meta.code);
  if (!bytes) return;
  keys = await deriveKeys(bytes);
  useSync.setState({ status: 'idle', lastAt: meta.lastAt });
  wire();
  requestSync();
  void renewPush(keys);
}

/** Turn sync on with a new code (`create`) or one from another device. Throws ApiError('not_found') for a code
 *  no device has used. */
export async function enableSync(code: string, mode: 'create' | 'join') {
  const bytes = parseCode(code);
  if (!bytes) throw new ApiError(400, 'bad_code');
  const k = await deriveKeys(bytes);
  if (mode === 'create') await createVault(k);
  else await vaultApi(k).pull(Number.MAX_SAFE_INTEGER); // 404 for an unknown code, nothing downloaded
  await db.transaction('rw', db.meta, db.sync, async () => {
    await db.sync.clear();
    await db.meta.put({ key: 'sync', code, seq: 0, codeCheckedAt: Date.now() }); // just written down or typed in
  });
  keys = k;
  useSync.setState({ status: 'idle', lastAt: undefined, error: undefined });
  wire();
  await run();
}

/** D40: a short one-time code for another device (10 minutes). */
export async function offerPairing(): Promise<string> {
  const meta = await db.meta.get('sync');
  if (!keys || !meta) throw new ApiError(400, 'off');
  const pair = newPairCode();
  const { pid, blob } = await sealForPairing(parsePairCode(pair)!, meta.code);
  await putPair(keys, pid, blob);
  return pair;
}

/** D40: the long code from a short one, taken from the server once. */
export async function codeFromPairing(pair: string): Promise<string> {
  const p = parsePairCode(pair);
  if (!p) throw new ApiError(400, 'bad_code');
  const { pid, open } = await pairId(p);
  return open(await takePair(pid));
}

/** Stop syncing on this device; its data stays here, the vault stays for the other devices. */
export async function disableSync() {
  await disablePush(keys);
  keys = undefined;
  clearTimeout(timer);
  await db.transaction('rw', db.meta, db.sync, async () => { await db.meta.delete('sync'); await db.sync.clear(); });
  useSync.setState({ status: 'off', lastAt: undefined, error: undefined });
}
