/** Clinic roles and the permission table (spec §9.1). Patients are not clinic members: they use Protocol Personal. */
export type Role = 'admin' | 'doctor';

export type Action =
  | 'staff.manage' | 'quota.view' | 'subscription.manage' | 'stats.view'
  | 'plan.create' | 'plan.edit_own_draft' | 'plan.confirm' | 'plan.issue';

const TABLE: Readonly<Record<Role, ReadonlySet<Action>>> = {
  admin: new Set<Action>(['staff.manage', 'quota.view', 'subscription.manage', 'stats.view']),
  doctor: new Set<Action>(['plan.create', 'plan.edit_own_draft', 'plan.confirm', 'plan.issue']),
};

export const can = (role: Role, action: Action): boolean => TABLE[role].has(action);
export const isRole = (x: unknown): x is Role => x === 'admin' || x === 'doctor';
