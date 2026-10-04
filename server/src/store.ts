// SQLite (node:sqlite): vaults, their encrypted records and daily counters. The server never sees plain data —
// a record is an opaque key and an opaque ciphertext (SPEC.md D31).
import { DatabaseSync } from 'node:sqlite';

export interface StoredRecord { k: string; v: string | null; seq: number }

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS vaults (id TEXT PRIMARY KEY, auth TEXT NOT NULL, created TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS records (vault TEXT NOT NULL, k TEXT NOT NULL, v TEXT, seq INTEGER NOT NULL, PRIMARY KEY (vault, k));
      CREATE INDEX IF NOT EXISTS records_seq ON records (vault, seq);
      CREATE TABLE IF NOT EXISTS counters (day TEXT NOT NULL, scope TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, scope));
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, n INTEGER NOT NULL);
      INSERT OR IGNORE INTO meta (k, n) VALUES ('seq', 0);
    `);
  }

  vaultAuth(id: string): string | undefined {
    const row = this.db.prepare('SELECT auth FROM vaults WHERE id = ?').get(id) as { auth: string } | undefined;
    return row?.auth;
  }

  createVault(id: string, authHash: string, now: Date): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO vaults (id, auth, created) VALUES (?, ?, ?)').run(id, authHash, now.toISOString());
    return r.changes === 1;
  }

  bytes(id: string): number {
    return (this.db.prepare('SELECT bytes FROM vaults WHERE id = ?').get(id) as { bytes: number } | undefined)?.bytes ?? 0;
  }

  /** Records changed after `since`, oldest first. */
  since(vault: string, since: number, limit: number): StoredRecord[] {
    return this.db.prepare('SELECT k, v, seq FROM records WHERE vault = ? AND seq > ? ORDER BY seq LIMIT ?')
      .all(vault, since, limit) as unknown as StoredRecord[];
  }

  latest(vault: string): number {
    return (this.db.prepare('SELECT MAX(seq) AS s FROM records WHERE vault = ?').get(vault) as { s: number | null }).s ?? 0;
  }

  /** Write records (v = null is a deletion, kept as a tombstone so other devices learn of it). Returns the last seq. */
  put(vault: string, records: { k: string; v: string | null }[]): number {
    const next = this.db.prepare("UPDATE meta SET n = n + 1 WHERE k = 'seq' RETURNING n");
    const old = this.db.prepare('SELECT length(v) AS l FROM records WHERE vault = ? AND k = ?');
    const upsert = this.db.prepare('INSERT INTO records (vault, k, v, seq) VALUES (?, ?, ?, ?) ON CONFLICT (vault, k) DO UPDATE SET v = excluded.v, seq = excluded.seq');
    const size = this.db.prepare('UPDATE vaults SET bytes = max(0, bytes + ?) WHERE id = ?');
    let seq = 0;
    this.db.exec('BEGIN');
    try {
      for (const r of records) {
        seq = (next.get() as { n: number }).n;
        const was = (old.get(vault, r.k) as { l: number | null } | undefined)?.l ?? 0;
        upsert.run(vault, r.k, r.v, seq);
        size.run((r.v?.length ?? 0) - was, vault);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return seq;
  }

  /** Count one use of `scope` today; false (and nothing counted) when the limit is reached. */
  take(scope: string, limit: number, now: Date): boolean {
    const day = now.toISOString().slice(0, 10);
    const n = (this.db.prepare('SELECT n FROM counters WHERE day = ? AND scope = ?').get(day, scope) as { n: number } | undefined)?.n ?? 0;
    if (n >= limit) return false;
    this.db.prepare('INSERT INTO counters (day, scope, n) VALUES (?, ?, 1) ON CONFLICT (day, scope) DO UPDATE SET n = n + 1').run(day, scope);
    return true;
  }

  close() { this.db.close(); }
}
