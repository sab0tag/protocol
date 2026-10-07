// Nightly copies of the database (SPEC.md D36): a consistent SQLite backup, checked, gzipped, kept 14 days in
// /backups; the `offsite` container of compose.yml copies them to the Storage Box. The vault records in them
// are encrypted on the devices, so a copy reveals nothing more than the live server does.
import { createReadStream, createWriteStream, existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync } from 'node:zlib';
import type { Store } from './store.ts';

const KEEP_DAYS = 14;

export async function backupOnce(store: Store, dir: string, now: Date): Promise<string | null> {
  const day = now.toISOString().slice(0, 10);
  const name = `protocol-${day}.db.gz`;
  if (existsSync(join(dir, name))) return null;
  const raw = join(dir, `.protocol-${day}.db`);
  await store.backupTo(raw);
  const check = new DatabaseSync(raw, { readOnly: true });
  const ok = (check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check === 'ok';
  const vaults = (check.prepare('SELECT COUNT(*) AS n FROM vaults').get() as { n: number }).n;
  check.close();
  const drop = () => { for (const f of [raw, `${raw}-wal`, `${raw}-shm`]) if (existsSync(f)) unlinkSync(f); };
  if (!ok) { drop(); throw new Error('backup failed integrity_check'); }
  await pipeline(createReadStream(raw), createGzip(), createWriteStream(join(dir, `.${name}`)));
  renameSync(join(dir, `.${name}`), join(dir, name));
  drop();
  for (const f of readdirSync(dir)) {
    if (/^protocol-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(f) && now.getTime() - statSync(join(dir, f)).mtimeMs > KEEP_DAYS * 86_400_000) unlinkSync(join(dir, f));
  }
  writeFileSync(join(dir, '.last_success'), now.toISOString());
  console.log(`backup: ${name}, ${vaults} vaults`);
  return name;
}

/** Hours since the last good backup (for /health), or null when there has never been one. */
export function backupAgeH(dir: string, now: Date): number | null {
  try { return Math.round((now.getTime() - statSync(join(dir, '.last_success')).mtimeMs) / 360_000) / 10; } catch { return null; }
}

/** D44: the nightly copies, newest first. */
export function listBackups(dir: string): string[] {
  try { return readdirSync(dir).filter((f) => /^protocol-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(f)).sort().reverse(); } catch { return []; }
}

/** D44: one vault's records in a copy (opened read-only from a temporary file, then removed). */
export function backupRecords(dir: string, name: string, vault: string): { k: string; v: string | null; seq: number }[] | null {
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  const tmp = join(tmpdir(), `pr-${process.pid}-${Date.now()}.db`);
  writeFileSync(tmp, gunzipSync(readFileSync(path)));
  try {
    const db = new DatabaseSync(tmp, { readOnly: true });
    const rows = db.prepare('SELECT k, v, seq FROM records WHERE vault = ? ORDER BY seq').all(vault) as { k: string; v: string | null; seq: number }[];
    db.close();
    return rows;
  } finally {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(f)) unlinkSync(f);
  }
}
