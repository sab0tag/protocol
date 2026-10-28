import { API_URL, ApiError } from './api';
import type { ClinicPlanV1 } from '../domain/planImport';

export interface ClinicMe { memberId: string; role: 'admin' | 'doctor'; displayName: string; organizationId: string; organizationName: string }
export interface StaffMember { id: string; displayName: string; role: 'admin' | 'doctor'; active: boolean }

async function clinic<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/clinic${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data);
  return data as T;
}

export const clinicMe = (t: string) => clinic<ClinicMe>(t, 'GET', '/me');
export const clinicStaff = (t: string) => clinic<{ staff: StaffMember[] }>(t, 'GET', '/staff').then((r) => r.staff);
export const clinicAddStaff = (t: string, displayName: string, role: 'admin' | 'doctor') =>
  clinic<{ memberId: string; token: string }>(t, 'POST', '/staff', { displayName, role });
export const clinicDeactivate = (t: string, id: string) => clinic<{ ok: true }>(t, 'DELETE', `/staff/${id}`);
export const clinicRotate = (t: string, id: string) => clinic<{ token: string }>(t, 'POST', `/staff/${id}/token`);
export const clinicIssue = (t: string, plan: ClinicPlanV1) =>
  clinic<{ deliveryId: string; code: string; expiresAt: number }>(t, 'POST', '/plans', { plan, patientConsent: true });
export const clinicRevoke = (t: string, id: string) => clinic<{ ok: true }>(t, 'DELETE', `/plans/${id}`);
export const clinicPlanStatus = (t: string, id: string) => clinic<{ status: 'pending' | 'redeemed' | 'revoked' | 'expired' }>(t, 'GET', `/plans/${id}`);
export interface ClinicStats { days: number; issued: number; redeemed: number; pending: number; expired: number; revoked: number; byDoctor: { memberId: string; displayName: string; issued: number }[] }
export const clinicStats = (t: string, days = 30) => clinic<ClinicStats>(t, 'GET', `/stats?days=${days}`);
