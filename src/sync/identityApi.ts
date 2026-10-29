import { API_URL, ApiError } from './api';
export interface IdentityContext { membershipId: string; organizationId: string; organizationName: string; roles: string[] }
export interface IdentitySession { account: { id: string }; csrfToken: string; auth: { mfa: boolean; authTime: number | null; recent: boolean; expiresAt: number }; contexts: IdentityContext[] }
async function request<T>(path: string, method = 'GET', csrf?: string, input?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(`${API_URL}${path}`, { method, credentials: 'include', cache: 'no-store', headers: { ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) }); }
  catch { throw new ApiError(0, 'offline'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body.error ?? 'identity_unavailable');
  return body as T;
}
export async function identityEnabled(): Promise<boolean> {
  try { return (await request<{ enabled: boolean }>('/v1/auth/config')).enabled === true; } catch { return false; }
}
export const identitySession = () => request<IdentitySession>('/v1/session');
export const identityLoginURL = (stepUp = false) => `${API_URL}/v1/auth/login?return=${encodeURIComponent('/#/clinic')}${stepUp ? '&purpose=step_up' : ''}`;
export const identityLogout = (session: IdentitySession, all = false) => request<{ ok: true }>(all ? '/v1/sessions/revoke-all' : '/v1/session/logout', 'POST', session.csrfToken);

export interface InvitationPreview { clinic: string; displayName: string; roles: string[]; expiresAt: number }
export const invitationPreview = (s: IdentitySession, code: string) => request<InvitationPreview>('/v1/session/invitations/preview', 'POST', s.csrfToken, { code });
export const invitationAccept = (s: IdentitySession, code: string) => request<{ organizationId: string; membershipId: string }>('/v1/session/invitations/accept', 'POST', s.csrfToken, { code });
