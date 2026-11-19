export type DirectoryError = 'unauthenticated' | 'forbidden' | 'not_found' | 'last_admin' | 'conflict' | 'bad_request' | 'suspended' | 'tokens_retired';
export class ClinicError extends Error {
  readonly code: DirectoryError;
  constructor(code: DirectoryError) { super(code); this.code = code; }
}
