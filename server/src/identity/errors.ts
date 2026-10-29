export type IdentityCode = 'unauthorized' | 'forbidden' | 'invalid_login' | 'mfa_required' | 'step_up_required' | 'identity_unavailable' | 'context_required';
export class IdentityError extends Error {
  readonly code: IdentityCode;
  constructor(code: IdentityCode) { super(code); this.code = code; }
}
