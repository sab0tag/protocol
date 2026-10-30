// When to sync (D31): on start, when the app comes back to the screen or online, a few seconds after any change,
// and every two minutes while open. One round at a time; a request during a round runs another after it.
import Dexie from 'dexie';
import { create } from 'zustand';
import { db } from '../data/db';
import { useUi } from '../store/ui';
import { ApiError, createVault, putPair, takePair, vaultApi } from './api';
import { deriveKeys, newPairCode, pairId, parseCode, parsePairCode, sealForPairing, type Keys } from './crypto';
import { repairPlan, syncOnce } from './engine';
import { disablePush, pushSchedule, renewPush, reconcileReminderPolicy, refreshPushNotifications } from './push';
import { ensureProgressOpened } from '../data/moduleStart';
import { MODULE_POLICY_ENABLED } from '../domain/rollout';
import { recoverSourcePlanQueue } from './sourcePlanRecovery';
import type { SourcePlanConflictReview } from './sourcePlanDelivery';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

interface SyncState { status: SyncStatus; lastAt?: number; error?: string; sourceReview?: SourcePlanConflictReview }
export const useSync = create<SyncState>(() => ({ status: 'off' }));

let keys: Keys | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false, again = false, wired = false, repairTried = false;
let generation = 0;

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
  const roundKeys = keys, roundGeneration = generation;
  const current = () => keys === roundKeys && generation === roundGeneration;
  useSync.setState({ status: 'syncing', error: undefined, sourceReview: undefined });
  try {
    // Recover a durable source send before any legacy cursor, journal, policy or reminder operation.
    // Source-mode vaults must not fall through to protocol-1 writes while migration remains incomplete.
    const recovery = await recoverSourcePlanQueue(db, roundKeys);
    if (!current()) return;
    if (recovery.kind !== 'none') {
      useSync.setState({ status: 'error', error: recovery.kind === 'conflict' ? 'source_plan_conflict'
        : recovery.kind === 'restored' ? 'source_plan_restore_required' : 'source_plan_migration_required',
      sourceReview: recovery.kind === 'conflict' ? recovery.review : undefined });
      return;
    }
    // Local off reaches the vault before a potentially slow encrypted-data round; failure stays pending for retry.
    await reconcileReminderPolicy(roundKeys).catch((e) => console.warn('reminder policy:', (e as Error).message));
    if (!current()) return;
    if (!repairTried) { // D43: once a run, before syncing — a plan that lost its parts is filled in from the vault's copy
      repairTried = true;
      if (await repairPlan(db, roundKeys, vaultApi(roundKeys)) && current()) useUi.getState().setOnboarded();
    }
    if (!current()) return;
    await syncOnce(db, roundKeys, vaultApi(roundKeys));
    if (!current()) return;
    if (MODULE_POLICY_ENABLED) await ensureProgressOpened(db);
    useSync.setState({ status: 'idle', lastAt: Date.now(), error: undefined });
    await pushSchedule(roundKeys).catch((e) => console.warn('reminders:', (e as Error).message)); // D34
  } catch (e) {
    if (!current()) return;
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
  Dexie.on('storagemutated', (parts) => {
    const policyChanged = Object.keys(parts).some((part) => part.startsWith(`idb://${db.name}/moduleEvents/`));
    if (policyChanged) refreshPushNotifications();
    if (running) again = true; else requestSync(policyChanged ? 0 : 3000);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestSync(); });
  window.addEventListener('online', () => requestSync());
  setInterval(() => { if (document.visibilityState === 'visible') requestSync(); }, 120_000);
}

/** On app start: resume if this device has a code. */
export async function startSync() {
  const meta = await db.meta.get('sync');
  const bytes = meta && parseCode(meta.code);
  if (!bytes || meta?.paused) return;
  const startingGeneration = generation, derived = await deriveKeys(bytes), latest = await db.meta.get('sync');
  if (latest?.code !== meta.code || latest.paused || generation !== startingGeneration) return;
  keys = derived;
  generation++;
  useSync.setState({ status: 'idle', lastAt: meta.lastAt });
  wire();
  requestSync();
  if (!meta.sourcePlanDelivery) void renewPush(keys);
}

/** Turn sync on with a new code (`create`) or one from another device. Throws ApiError('not_found') for a code
 *  no device has used. */
export async function enableSync(code: string, mode: 'create' | 'join') {
  if ((await db.meta.get('sync'))?.sourcePlanDelivery) throw new ApiError(409, 'source_plan_connection_pending');
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
  generation++;
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
  const previousKeys = keys;
  keys = undefined;
  generation++;
  clearTimeout(timer);
  await db.transaction('rw', db.meta, db.sync, async () => {
    const meta = await db.meta.get('sync');
    if (meta?.sourcePlanDelivery) await db.meta.update('sync', { paused: true });
    else { await db.meta.delete('sync'); await db.sync.clear(); }
  });
  useSync.setState({ status: 'off', lastAt: undefined, error: undefined, sourceReview: undefined });
  await disablePush(previousKeys);
}

/** Resume a paused device without deleting its pending encrypted send or changing its vault. */
export async function resumeSync() {
  await db.meta.update('sync', { paused: false });
  await startSync();
}
