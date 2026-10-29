import { API_URL, ApiError } from './api';
import type { ClinicPlanV1 } from '../domain/planImport';

export interface ClinicMe { memberId: string; role: 'admin' | 'doctor'; displayName: string; organizationId: string; organizationName: string; roles?: ('admin' | 'doctor')[] }
export interface StaffMember { id: string; displayName: string; role: 'admin' | 'doctor'; active: boolean; roles?: ('admin' | 'doctor')[]; linked?: boolean }
export type ClinicAuth = string | { csrfToken: string; organizationId: string; signal?: AbortSignal; onDenied?: () => void };

async function clinic<T>(token: ClinicAuth, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const legacy = typeof token === 'string';
    res = await fetch(`${API_URL}/v1/clinic${path}`, {
      method, credentials: legacy ? 'omit' : 'include', cache: 'no-store',
      ...(!legacy && token.signal ? { signal: token.signal } : {}),
      headers: { ...(legacy ? { Authorization: `Bearer ${token}` } : { 'X-Clinic-Id': token.organizationId,
        ...(method !== 'GET' ? { 'X-CSRF-Token': token.csrfToken } : {}) }), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) {
    if (typeof token !== 'string' && !token.signal?.aborted && ['unauthorized', 'unauthenticated', 'forbidden', 'mfa_required', 'context_required'].includes(data.error ?? '')) token.onDenied?.();
    throw new ApiError(res.status, data.error ?? 'error', data);
  }
  return data as T;
}

export const clinicMe = (t: ClinicAuth) => clinic<ClinicMe>(t, 'GET', '/me');
export const clinicStaff = (t: ClinicAuth) => clinic<{ staff: StaffMember[] }>(t, 'GET', '/staff').then((r) => r.staff);
export const clinicAddStaff = (t: ClinicAuth, displayName: string, role: 'admin' | 'doctor') =>
  clinic<{ memberId: string; token: string }>(t, 'POST', '/staff', { displayName, role });
export const clinicDeactivate = (t: ClinicAuth, id: string) => clinic<{ ok: true }>(t, 'DELETE', `/staff/${id}`);
export const clinicRotate = (t: ClinicAuth, id: string) => clinic<{ token: string }>(t, 'POST', `/staff/${id}/token`);
export const clinicIssue = (t: ClinicAuth, plan: ClinicPlanV1) =>
  clinic<{ deliveryId: string; code: string; expiresAt: number }>(t, 'POST', '/plans', { plan, patientConsent: true });
export const clinicRevoke = (t: ClinicAuth, id: string) => clinic<{ ok: true }>(t, 'DELETE', `/plans/${id}`);
export const clinicPlanStatus = (t: ClinicAuth, id: string) => clinic<{ status: 'pending' | 'redeemed' | 'revoked' | 'expired' | 'tampered' }>(t, 'GET', `/plans/${id}`);
export interface ClinicStats { days: number; issued: number; redeemed: number; pending: number; expired: number; revoked: number; tampered?: number; byDoctor: { memberId: string; displayName: string; issued: number }[] }
export const clinicStats = (t: ClinicAuth, days = 30) => clinic<ClinicStats>(t, 'GET', `/stats?days=${days}`);

export interface StaffInvite { id: string; email: string; displayName: string; roles: string[]; expiresAt: number; state: string; targetMemberId: string | null }
export const clinicInvitations = (a: ClinicAuth) => clinic<{ enabled: boolean; invitations: StaffInvite[] }>(a, 'GET', '/invitations');
export const clinicInvite = (a: ClinicAuth, input: { email: string; displayName: string; roles: string[]; targetMemberId?: string }) => clinic<{ id: string; expiresAt: number }>(a, 'POST', '/invitations', input);
export const clinicRevokeInvite = (a: ClinicAuth, id: string) => clinic<{ ok: true }>(a, 'DELETE', `/invitations/${id}`);
export const clinicSetRoles = (a: ClinicAuth, id: string, roles: string[]) => clinic<{ ok: true }>(a, 'PUT', `/staff/${id}/roles`, { roles });
export interface AuthTransition { migratedAt: number | null; legacyUntil: number | null; unlinked: string[] }
export const clinicAuthTransition = (a: ClinicAuth) => clinic<AuthTransition>(a, 'GET', '/auth-transition');
export const clinicCutover = (a: ClinicAuth, graceHours: number) => clinic<{ ok: true }>(a, 'POST', '/auth-transition', { graceHours, confirm: true });
