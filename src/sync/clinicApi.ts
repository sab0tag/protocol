import { API_URL, ApiError } from './api';
import type { ClinicPlanV1 } from '../domain/planImport';

export interface ClinicMe { memberId: string; role: 'admin' | 'doctor'; displayName: string; organizationId: string; organizationName: string }
export interface StaffMember { id: string; displayName: string; role: 'admin' | 'doctor'; active: boolean }
export type ClinicAuth = string | { csrfToken: string; organizationId: string; signal?: AbortSignal; onDenied?: () => void };

async function clinic<T>(token: ClinicAuth, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const legacy = typeof token === 'string';
    res = await fetch(`${legacy ? API_URL : ''}/v1/clinic${path}`, {
      method, credentials: legacy ? 'omit' : 'same-origin', cache: 'no-store',
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
    if (typeof token !== 'string' && !token.signal?.aborted && ['unauthorized', 'forbidden', 'mfa_required', 'context_required'].includes(data.error ?? '')) token.onDenied?.();
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
