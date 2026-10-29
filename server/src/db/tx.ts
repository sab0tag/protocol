import type { DatabaseSync } from 'node:sqlite';

/** Raised when SQLite could not get the write lock within `busy_timeout`. Retryable; nothing was changed. */
export class DatabaseBusy extends Error {
  constructor() { super('database_busy'); }
}

/** SQLITE_BUSY and its extended codes (BUSY_RECOVERY, BUSY_SNAPSHOT, BUSY_TIMEOUT) share the low byte 5. */
export const isBusy = (e: unknown): boolean => {
  const c = (e as { errcode?: unknown } | null)?.errcode;
  return typeof c === 'number' && (c & 0xff) === 5;
};

/**
 * Runs `f` in one `BEGIN IMMEDIATE` transaction: the write lock is taken before anything is read, so two connections
 * cannot both see the same pending row. Any exception rolls back; a busy lock (on BEGIN or COMMIT) becomes
 * `DatabaseBusy` once our own transaction is closed. Never nested: callers own exactly one transaction.
 */
export function immediate<T>(db: DatabaseSync, f: () => T): T {
  try {
    db.exec('BEGIN IMMEDIATE');
  } catch (e) {
    throw isBusy(e) ? new DatabaseBusy() : e;
  }
  try {
    const out = f();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw isBusy(e) ? new DatabaseBusy() : e;
  }
}
