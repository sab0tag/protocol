import { profileKey } from '../data/profiles';
// The Протокол API over fetch (server/: SPEC.md D31, D32).
import type { MenuResult } from '../domain/menu';
import type { AiWorkout, WorkoutBody } from '../domain/aiWorkout';
import type { PhotoResult } from '../domain/photo';
import type { Keys } from './crypto';
import type { Api, RemoteRecord } from './engine';
import type { ReminderPolicy } from '../../server/src/reminderPolicy';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'https://api.beyondthesignal.to';

export class ApiError extends Error {
  /** `data` — the rest of the error's body (D123: how many dishes are left today) */
  constructor(public status: number, public code: string, public data: Record<string, unknown> = {}) { super(code); }
}

export async function call<T>(keys: Keys, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/vaults/${keys.vaultId}${path}`, {
      method, headers: { Authorization: `Bearer ${keys.auth}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data);
  return data as T;
}

// Explicit legacy capability until the normalized sync adapter is implemented. Old servers ignore these fields.
export const CLIENT_DATA_PROTOCOL = 1;
export const createVault = (keys: Keys) => call<{ created: boolean }>(keys, 'PUT', '');

export function vaultApi(keys: Keys): Api {
  return {
    pull: (since) => call<{ records: RemoteRecord[]; more: boolean; seq: number }>(keys, 'GET', `/records?since=${since}&protocol=${CLIENT_DATA_PROTOCOL}`),
    push: (records) => call<{ seq: number }>(keys, 'POST', '/records', { records, protocol: CLIENT_DATA_PROTOCOL }),
  };
}

export const photo = (keys: Keys, image: string, foods: string[], dishes: string[]) =>
  call<PhotoResult>(keys, 'POST', '/photo', { image, foods, dishes });

export interface MenuBody {
  date: string; targets: Record<string, number | string>; rules: string[];
  foods: string[]; dishes: string[]; usual: string[]; wish: string; avoid: string[];
}

export const menu = (keys: Keys, body: MenuBody) => call<MenuResult>(keys, 'POST', '/menu', body);
// D68
import type { ConclusionResult } from '../domain/conclusion';
import type { DishResult } from '../domain/dishBreakdown';
export interface LabsResult { readable: boolean; date: string | null; items: { name: string; value: number; unit: string; reference: string | null }[]; note: string | null }
export const labs = (keys: Keys, image: string, names: string[]) => call<LabsResult>(keys, 'POST', '/labs', { image, names });
// D80, D101: up to 4 pages; with sync through the vault, without it through this device's token (the first screen of
// onboarding needs no account). The token lives on this device only; a lost or unknown one is asked for again, once.
const DEVICE = profileKey('protocol.deviceToken');
let deviceMem: string | undefined;
async function deviceToken(fresh: boolean): Promise<string> {
  if (!fresh) { try { deviceMem ??= localStorage.getItem(DEVICE) ?? undefined; } catch { /* private mode — kept in memory */ } }
  if (deviceMem && !fresh) return deviceMem;
  let res: Response;
  try { res = await fetch(`${API_URL}/v1/devices`, { method: 'POST' }); } catch { throw new ApiError(0, 'offline'); }
  const data = await res.json().catch(() => ({})) as { token?: string; error?: string };
  if (!res.ok || !data.token) throw new ApiError(res.status, data.error ?? 'error');
  deviceMem = data.token;
  try { localStorage.setItem(DEVICE, data.token); } catch { /* private mode */ }
  return data.token;
}
/** With sync — through the vault; without it — through this device's token (asked for again once if the server lost it). */
async function vaultOrDevice<T>(keys: Keys | null, path: string, body: unknown): Promise<T> {
  if (keys) return call<T>(keys, 'POST', `/${path}`, body);
  for (const fresh of [false, true]) {
    const token = await deviceToken(fresh);
    let res: Response;
    try {
      res = await fetch(`${API_URL}/v1/device/${path}`, { method: 'POST', headers: { Authorization: `Device ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body) });
    } catch { throw new ApiError(0, 'offline'); }
    const data = await res.json().catch(() => ({})) as { error?: string };
    if (res.status === 401 && !fresh) continue;
    if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data);
    return data as T;
  }
  throw new ApiError(401, 'unauthorized');
}
export const conclusion = (keys: Keys | null, images: string[]) => vaultOrDevice<ConclusionResult>(keys, 'conclusion', { images });
// D117: the assistant's chat — vault or device; the reply is checked by the server on the way out
export interface ChatReply { topic: 'food' | 'medicine' | 'symptoms' | 'plan' | 'other'; text: string; items: { name: string; grams: number }[]; id?: string }
export interface ChatBody { text: string; history: { role: 'user' | 'assistant'; text: string }[]; names: string[]; context: unknown; log: boolean; versions: { app: string; plan: string } }
export const assistantChat = (keys: Keys | null, body: ChatBody) => vaultOrDevice<ChatReply>(keys, 'concierge/chat', body);
// D110: a dish described in words → its ingredients; the base's names go along so the model can name what is in it
export const dishBreakdown = (keys: Keys | null, text: string, foods: string[]) => vaultOrDevice<DishResult>(keys, 'dish', { text, foods });
/** D123: up to 15 dishes at once, each with its make-up; the base's names once */
export const dishesBreakdown = (keys: Keys | null, dishes: { key: string; text: string }[], foods: string[]) =>
  vaultOrDevice<{ dishes: (DishResult & { key: string })[] }>(keys, 'dishes', { dishes, foods });
export interface MedboxResult { readable: boolean; name: string | null; inn: string | null; strength: string | null; form: string | null; note: string | null }
export const medbox = (keys: Keys, image: string) => call<MedboxResult>(keys, 'POST', '/medbox', { image }); // D89
// D91: the concierge
export interface NotFoundBody { text: string; names: string[]; log: boolean; versions: { app: string; plan: string }; context: Record<string, unknown> }
export const conciergeNotFound = (keys: Keys, body: NotFoundBody) => call<{ candidates: string[]; id?: string }>(keys, 'POST', '/concierge/not-found', body);
export type Outcome = 'accepted' | 'edited' | 'dismissed' | 'snoozed' | 'ignored';
export const conciergeOutcome = (keys: Keys, id: string, outcome: Outcome, edit?: unknown) =>
  call<{ ok: boolean }>(keys, 'POST', '/concierge/outcome', { id, outcome, ...(edit ? { edit } : {}) });
export interface LogRecord { id: string; ts: string; scenario: string; input: string; output: { items: { name: string }[] }; outcome: Outcome | null }
export const conciergeLog = (keys: Keys) => call<LogRecord[]>(keys, 'GET', '/concierge/log');
export const deleteConciergeLog = (keys: Keys) => call<{ deleted: number }>(keys, 'DELETE', '/concierge/log');
// D63
export const aiWorkout = (keys: Keys, body: WorkoutBody) => call<AiWorkout>(keys, 'POST', '/workout', body);

// D34: reminders
export async function pushKey(): Promise<string> {
  let res: Response;
  try { res = await fetch(`${API_URL}/v1/push/key`); } catch { throw new ApiError(0, 'offline'); }
  if (!res.ok) throw new ApiError(res.status, 'push_off');
  return ((await res.json()) as { key: string }).key;
}
export const putDevice = (keys: Keys, dev: string, subscription: PushSubscriptionJSON) =>
  call<{ ok: true }>(keys, 'PUT', `/devices/${dev}`, { subscription });
export const dropDevice = (keys: Keys, dev: string) => call<{ ok: true }>(keys, 'DELETE', `/devices/${dev}`);
export const putReminders = (keys: Keys, dev: string, body: unknown) => call<{ ok: true; count: number }>(keys, 'PUT', `/devices/${dev}/reminders`, body);
export const putReminderPolicy = (keys: Keys, body: ReminderPolicy) => call<{ ok: true; v: 1 }>(keys, 'PUT', '/reminder-policy', body);
export const testPush = (keys: Keys, dev: string) => call<{ ok: true }>(keys, 'POST', `/devices/${dev}/test`);

export const usage = (keys: Keys) => call<{ month: string; kinds: Record<string, number>; usd: number; usdMicro?: number }>(keys, 'GET', '/usage');

// D40: pairing
export const putPair = (keys: Keys, pid: string, blob: string) => call<{ ok: true }>(keys, 'POST', '/pair', { pid, blob });
export async function takePair(pid: string): Promise<string> {
  let res: Response;
  try { res = await fetch(`${API_URL}/v1/pair/${pid}`); } catch { throw new ApiError(0, 'offline'); }
  const data = await res.json().catch(() => ({})) as { blob?: string; error?: string };
  if (!res.ok || !data.blob) throw new ApiError(res.status, res.status === 404 ? 'pair_not_found' : data.error ?? 'error');
  return data.blob;
}

// D44: sealed records from the server's nightly copies
export const backups = (keys: Keys) => call<{ backups: string[] }>(keys, 'GET', '/backups');
export const backupRecords = (keys: Keys, name: string) => call<{ records: RemoteRecord[] }>(keys, 'GET', `/backups/${name}`);

// D45: a package's nutrition table
export interface LabelResult {
  readable: boolean; name: string; servingG: number | null; note: string | null;
  per100g: { kcal: number; protein: number; fat: number; carbs: number; calciumMg: number | null };
}
export const label = (keys: Keys, image: string) => call<LabelResult>(keys, 'POST', '/label', { image });

// D119: the pilot — its own participant (pid + secret), never the vault or the device token
async function pilotFetch<T>(method: string, path: string, auth?: { pid: string; secret: string }, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/pilot${path}`, { method,
      headers: { ...(auth ? { Authorization: `Pilot ${auth.pid}.${auth.secret}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new ApiError(0, 'offline'); }
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error');
  return data as T;
}
export const pilotJoin = () => pilotFetch<{ pid: string; secret: string }>('POST', '/join');
export const pilotSend = (auth: { pid: string; secret: string }, body: unknown) => pilotFetch<{ ok: true }>('POST', '/week', auth, body);
export const pilotLeave = (auth: { pid: string; secret: string }) => pilotFetch<{ ok: true }>('DELETE', '', auth);
/** Is a doctor's code known; `visit` — the QR link was opened (counted on the server by day and code, nothing else). */
export const pilotSource = (code: string, visit: boolean) => pilotFetch<{ known: boolean }>('GET', `/src/${encodeURIComponent(code)}${visit ? '?visit=1' : ''}`);

/** PR-13: redeem a clinic's one-time code. No account; the plan is returned once. */
export async function redeemClinicPlan(code: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/clinic/plans/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  } catch {
    throw new ApiError(0, 'offline');
  }
  const data = await res.json().catch(() => ({})) as { error?: string; plan?: unknown };
  if (!res.ok) {
    const ra = Number(res.headers.get('Retry-After'));
    throw new ApiError(res.status, data.error ?? 'error', { ...data, ...(Number.isFinite(ra) && ra > 0 ? { retryAfterS: Math.min(ra, 30) } : {}) });
  }
  return data.plan;
}
