export type DirectoryError = 'unauthenticated' | 'forbidden' | 'not_found' | 'last_admin' | 'bad_request';
export class ClinicError extends Error {
  readonly code: DirectoryError;
  constructor(code: DirectoryError) { super(code); this.code = code; }
}
