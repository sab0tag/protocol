import { ApiError } from './api';

export interface IdentityContext { membershipId: string; organizationId: string; organizationName: string; roles: string[] }
export interface IdentitySession { accountId: string; csrfToken: string; mfa: boolean; authTime: number; contexts: IdentityContext[] }

async function request<T>(path: string, method = 'GET', csrf?: string): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: csrf ? { 'X-CSRF-Token': csrf } : {} }); }
  catch { throw new ApiError(0, 'offline'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body.error ?? 'identity_unavailable');
  return body as T;
}
export async function identityEnabled(): Promise<boolean> {
  try { return (await request<{ enabled: boolean }>('/v1/identity/config')).enabled === true; } catch { return false; }
}
export const identitySession = () => request<IdentitySession>('/v1/session');
export const identityLogout = (session: IdentitySession, all = false) => request<{ ok: true; logoutUrl: string }>(all ? '/v1/sessions/revoke-all' : '/v1/session/logout', 'POST', session.csrfToken);
