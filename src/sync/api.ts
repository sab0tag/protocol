// The Протокол API over fetch (server/: SPEC.md D31, D32).
import type { MenuResult } from '../domain/menu';
import type { PhotoResult } from '../domain/photo';
import type { Keys } from './crypto';
import type { Api, RemoteRecord } from './engine';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'https://api.beyondthesignal.to';

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

async function call<T>(keys: Keys, method: string, path: string, body?: unknown): Promise<T> {
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
  foods: string[]; dishes: string[]; usual: string[]; wish: string;
}

export const menu = (keys: Keys, body: MenuBody) => call<MenuResult>(keys, 'POST', '/menu', body);
