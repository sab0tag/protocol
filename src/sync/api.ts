// The Протокол API over fetch (server/: SPEC.md D31, D32).
import type { MenuResult } from '../domain/menu';
import type { PhotoResult } from '../domain/photo';
import type { Keys } from './crypto';
import type { Api, RemoteRecord } from './engine';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'https://api.beyondthesignal.to';

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
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
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error');
  return data as T;
}

export const createVault = (keys: Keys) => call<{ created: boolean }>(keys, 'PUT', '');

export function vaultApi(keys: Keys): Api {
  return {
    pull: (since) => call<{ records: RemoteRecord[]; more: boolean; seq: number }>(keys, 'GET', `/records?since=${since}`),
    push: (records) => call<{ seq: number }>(keys, 'POST', '/records', { records }),
  };
}

export const photo = (keys: Keys, image: string, foods: string[], dishes: string[]) =>
  call<PhotoResult>(keys, 'POST', '/photo', { image, foods, dishes });

export interface MenuBody {
  date: string; targets: Record<string, number | string>; rules: string[];
  foods: string[]; dishes: string[]; usual: string[]; wish: string; avoid: string[];
}

export const menu = (keys: Keys, body: MenuBody) => call<MenuResult>(keys, 'POST', '/menu', body);

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
export const testPush = (keys: Keys, dev: string) => call<{ ok: true }>(keys, 'POST', `/devices/${dev}/test`);

export const usage = (keys: Keys) => call<{ month: string; kinds: Record<string, number>; usd: number }>(keys, 'GET', '/usage');

// D40: pairing
export const putPair = (keys: Keys, pid: string, blob: string) => call<{ ok: true }>(keys, 'POST', '/pair', { pid, blob });
export async function takePair(pid: string): Promise<string> {
  let res: Response;
  try { res = await fetch(`${API_URL}/v1/pair/${pid}`); } catch { throw new ApiError(0, 'offline'); }
  const data = await res.json().catch(() => ({})) as { blob?: string; error?: string };
  if (!res.ok || !data.blob) throw new ApiError(res.status, res.status === 404 ? 'pair_not_found' : data.error ?? 'error');
  return data.blob;
}
