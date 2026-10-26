// SQLite (node:sqlite): vaults, their encrypted records and daily counters. The server never sees plain data —
// a record is an opaque key and an opaque ciphertext (SPEC.md D31).
import { backup, DatabaseSync } from 'node:sqlite';
import { emptyPolicy, mergeReminderPolicy, reminderAllowed, type ReminderPolicy } from './reminderPolicy.ts';

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
      CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS push_subs (vault TEXT NOT NULL, device TEXT NOT NULL, sub TEXT NOT NULL, updated INTEGER NOT NULL,
        PRIMARY KEY (vault, device));
      CREATE TABLE IF NOT EXISTS reminders (vault TEXT NOT NULL, device TEXT NOT NULL, rid TEXT NOT NULL, at INTEGER NOT NULL,
        payload TEXT NOT NULL, next_at INTEGER NOT NULL, repeats_left INTEGER NOT NULL, repeat_every INTEGER NOT NULL, sent INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (vault, device, rid));
      CREATE INDEX IF NOT EXISTS reminders_due ON reminders (next_at);
      CREATE TABLE IF NOT EXISTS reminder_policies (vault TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reminder_clients (vault TEXT NOT NULL, device TEXT NOT NULL, aware INTEGER NOT NULL,
        PRIMARY KEY (vault, device));
      CREATE TABLE IF NOT EXISTS usage (vault TEXT NOT NULL, month TEXT NOT NULL, kind TEXT NOT NULL, calls INTEGER NOT NULL,
        usd_micro INTEGER NOT NULL, PRIMARY KEY (vault, month, kind));
      CREATE TABLE IF NOT EXISTS pairs (pid TEXT PRIMARY KEY, blob TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS acks (vault TEXT NOT NULL, rid TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (vault, rid));
      CREATE TABLE IF NOT EXISTS device_tokens (h TEXT PRIMARY KEY, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS concierge_log (id TEXT PRIMARY KEY, vault TEXT NOT NULL, ts INTEGER NOT NULL, scenario TEXT NOT NULL,
        record TEXT NOT NULL, outcome TEXT, edit TEXT);
      CREATE INDEX IF NOT EXISTS concierge_log_vault ON concierge_log (vault, ts);
      CREATE TABLE IF NOT EXISTS pushed (vault TEXT NOT NULL, rid TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (vault, rid));
      CREATE TABLE IF NOT EXISTS vault_weeks (vault TEXT NOT NULL, week TEXT NOT NULL, PRIMARY KEY (vault, week));
      CREATE TABLE IF NOT EXISTS pilot_members (pid TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, joined TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pilot_weeks (pid TEXT NOT NULL, week TEXT NOT NULL, kind TEXT NOT NULL, src TEXT, body TEXT NOT NULL,
        PRIMARY KEY (pid, week, kind));
      CREATE TABLE IF NOT EXISTS pilot_sources (code TEXT PRIMARY KEY, label TEXT NOT NULL, issued TEXT NOT NULL);
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

  /** Add `by` to a day's counter with no limit (D119: the ops numbers — `stat:*` scopes, never an id or an address). */
  bump(scope: string, by: number, now: Date) {
    this.db.prepare('INSERT INTO counters (day, scope, n) VALUES (?, ?, ?) ON CONFLICT (day, scope) DO UPDATE SET n = n + excluded.n')
      .run(now.toISOString().slice(0, 10), scope, Math.round(by));
  }

  /** D122: the day limits' counters older than `before` (a day) go; the ops numbers (`stat:*`) and the QR counts (`qr:*`) stay. */
  purgeCounters(before: string): number {
    return Number(this.db.prepare("DELETE FROM counters WHERE day < ? AND scope NOT LIKE 'stat:%' AND scope NOT LIKE 'qr:%'").run(before).changes);
  }

  /** Today's count of `scope`. */
  count(scope: string, now: Date): number {
    return (this.db.prepare('SELECT n FROM counters WHERE day = ? AND scope = ?').get(now.toISOString().slice(0, 10), scope) as { n: number } | undefined)?.n ?? 0;
  }

  /** Count one use of `scope` today; false (and nothing counted) when the limit is reached. */
  take(scope: string, limit: number, now: Date): boolean {
    const day = now.toISOString().slice(0, 10);
    const n = (this.db.prepare('SELECT n FROM counters WHERE day = ? AND scope = ?').get(day, scope) as { n: number } | undefined)?.n ?? 0;
    if (n >= limit) return false;
    this.db.prepare('INSERT INTO counters (day, scope, n) VALUES (?, ?, 1) ON CONFLICT (day, scope) DO UPDATE SET n = n + 1').run(day, scope);
    return true;
  }

  setting(k: string): string | undefined {
    return (this.db.prepare('SELECT v FROM settings WHERE k = ?').get(k) as { v: string } | undefined)?.v;
  }

  setSetting(k: string, v: string) {
    this.db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').run(k, v);
  }

  // ---------------------------------------------------------------- push (SPEC.md D34)
  devices(vault: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE vault = ?').get(vault) as { n: number }).n;
  }

  hasDevice(vault: string, device: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM push_subs WHERE vault = ? AND device = ?').get(vault, device);
  }

  putSub(vault: string, device: string, sub: string, now: number) {
    this.db.prepare('INSERT INTO push_subs (vault, device, sub, updated) VALUES (?, ?, ?, ?) ON CONFLICT (vault, device) DO UPDATE SET sub = excluded.sub, updated = excluded.updated')
      .run(vault, device, sub, now);
  }

  sub(vault: string, device: string): string | undefined {
    return (this.db.prepare('SELECT sub FROM push_subs WHERE vault = ? AND device = ?').get(vault, device) as { sub: string } | undefined)?.sub;
  }

  dropDevice(vault: string, device: string) {
    this.db.prepare('DELETE FROM push_subs WHERE vault = ? AND device = ?').run(vault, device);
    this.db.prepare('DELETE FROM reminders WHERE vault = ? AND device = ?').run(vault, device);
    this.db.prepare('DELETE FROM reminder_clients WHERE vault = ? AND device = ?').run(vault, device);
  }

  reminderPolicy(vault: string): ReminderPolicy {
    const row = this.db.prepare('SELECT body FROM reminder_policies WHERE vault = ?').get(vault) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as ReminderPolicy : emptyPolicy();
  }

  /** Vault-wide, independent of this device's push subscription. No omitted or older choice can undo an off. */
  setReminderPolicy(vault: string, policy: ReminderPolicy, now: number) {
    const merged = mergeReminderPolicy(this.reminderPolicy(vault), policy);
    merged.days = merged.days.filter((d) => d.until >= now - 7 * 86_400_000);
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO reminder_policies (vault, body) VALUES (?, ?) ON CONFLICT (vault) DO UPDATE SET body = excluded.body')
        .run(vault, JSON.stringify(merged));
      this.pruneReminders(vault, now);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  private pruneReminders(vault: string, now: number) {
    const policy = this.reminderPolicy(vault);
    const rows = this.db.prepare(`SELECT r.device, r.rid, r.at, r.payload, coalesce(c.aware, 0) AS aware FROM reminders r
      LEFT JOIN reminder_clients c ON c.vault = r.vault AND c.device = r.device WHERE r.vault = ?`).all(vault) as
      { device: string; rid: string; at: number; payload: string; aware: number }[];
    const del = this.db.prepare('DELETE FROM reminders WHERE vault = ? AND device = ? AND rid = ?');
    for (const r of rows) if (!reminderAllowed(policy, JSON.parse(r.payload), r.at, now, !!r.aware)) del.run(vault, r.device, r.rid);
  }

  reminderAware(vault: string, device: string): boolean {
    return !!(this.db.prepare('SELECT aware FROM reminder_clients WHERE vault = ? AND device = ?').get(vault, device) as { aware: number } | undefined)?.aware;
  }

  /** The device's whole schedule: unknown reminders go away; a known one keeps its progress (sent, repeats)
   *  unless its time moved; `done` ones are acknowledged for every device of the vault. */
  setReminders(vault: string, device: string, items: { rid: string; at: number; payload: string; once?: boolean }[],
    repeatEvery: number, repeats: number, done: string[], now: number, aware = false) {
    const old = new Map((this.db.prepare('SELECT rid, at FROM reminders WHERE vault = ? AND device = ?').all(vault, device) as { rid: string; at: number }[])
      .map((r) => [r.rid, r.at]));
    const keep = new Set(items.map((i) => i.rid));
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO reminder_clients (vault, device, aware) VALUES (?, ?, ?) ON CONFLICT (vault, device) DO UPDATE SET aware = excluded.aware')
        .run(vault, device, Number(aware));
      const del = this.db.prepare('DELETE FROM reminders WHERE vault = ? AND device = ? AND rid = ?');
      for (const rid of old.keys()) if (!keep.has(rid)) del.run(vault, device, rid);
      const ins = this.db.prepare(`INSERT INTO reminders (vault, device, rid, at, payload, next_at, repeats_left, repeat_every) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (vault, device, rid) DO UPDATE SET payload = excluded.payload, repeat_every = excluded.repeat_every`);
      const moved = this.db.prepare('UPDATE reminders SET at = ?, next_at = ?, repeats_left = ?, sent = 0 WHERE vault = ? AND device = ? AND rid = ?');
      for (const i of items) {
        if (!old.has(i.rid) && i.at < now - 60_000) continue; // already past when it first arrives: not ours to send late
        const n = i.once ? 0 : repeats;
        if (old.has(i.rid) && old.get(i.rid) !== i.at) moved.run(i.at, i.at, n, vault, device, i.rid);
        ins.run(vault, device, i.rid, i.at, i.payload, i.at, n, repeatEvery);
      }
      const ack = this.db.prepare('INSERT OR IGNORE INTO acks (vault, rid, at) VALUES (?, ?, ?)');
      const sentAt = this.db.prepare('SELECT at FROM pushed WHERE vault = ? AND rid = ?');
      for (const rid of done) {
        const was = (sentAt.get(vault, rid) as { at: number } | undefined)?.at ?? null;
        if (ack.run(vault, rid, now).changes === 1 && was !== null) { // D119: a reaction to a push that came, and how late
          this.bump('stat:rem_acked', 1, new Date(now));
          this.bump('stat:rem_ack_min', Math.min(24 * 60, Math.max(0, (now - was) / 60_000)), new Date(now));
        }
      }
      this.db.prepare('DELETE FROM acks WHERE at < ?').run(now - 7 * 86_400_000);
      this.db.prepare('DELETE FROM pushed WHERE at < ?').run(now - 7 * 86_400_000);
      this.pruneReminders(vault, now); // also protects against an old device re-uploading its obsolete queue
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  due(now: number): { vault: string; device: string; rid: string; at: number; next_at: number; payload: string; repeats_left: number; repeat_every: number; sent: number; sub: string | null; acked: number }[] {
    return this.db.prepare(`SELECT r.vault, r.device, r.rid, r.at, r.next_at, r.payload, r.repeats_left, r.repeat_every, r.sent, s.sub,
        EXISTS (SELECT 1 FROM acks a WHERE a.vault = r.vault AND a.rid = r.rid) AS acked
      FROM reminders r LEFT JOIN push_subs s ON s.vault = r.vault AND s.device = r.device WHERE r.next_at <= ? ORDER BY r.next_at LIMIT 200`)
      .all(now) as never;
  }

  /** D119: the first push of a reminder (its planned time), to count a reaction to it; once per vault, whatever the devices. */
  pushedFirst(vault: string, rid: string, at: number): boolean {
    return this.db.prepare('INSERT OR IGNORE INTO pushed (vault, rid, at) VALUES (?, ?, ?)').run(vault, rid, at).changes === 1;
  }

  afterSend(vault: string, device: string, rid: string, nextAt: number | null) {
    if (nextAt === null) this.db.prepare('DELETE FROM reminders WHERE vault = ? AND device = ? AND rid = ?').run(vault, device, rid);
    else this.db.prepare('UPDATE reminders SET next_at = ?, repeats_left = repeats_left - 1, sent = sent + 1 WHERE vault = ? AND device = ? AND rid = ?')
      .run(nextAt, vault, device, rid);
  }

  // ---------------------------------------------------------------- pairing a new device (D40)
  putPair(pid: string, blob: string, expires: number, now: number) {
    this.db.prepare('DELETE FROM pairs WHERE expires < ?').run(now);
    this.db.prepare('INSERT OR REPLACE INTO pairs (pid, blob, expires) VALUES (?, ?, ?)').run(pid, blob, expires);
  }

  /** One time only: the blob is gone once read. */
  takePair(pid: string, now: number): string | undefined {
    const row = this.db.prepare('DELETE FROM pairs WHERE pid = ? RETURNING blob, expires').get(pid) as { blob: string; expires: number } | undefined;
    return row && row.expires >= now ? row.blob : undefined;
  }

  // ---------------------------------------------------------------- AI spend (D36)
  addUsage(vault: string, kind: string, usdMicro: number, now: Date) {
    this.db.prepare(`INSERT INTO usage (vault, month, kind, calls, usd_micro) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT (vault, month, kind) DO UPDATE SET calls = calls + 1, usd_micro = usd_micro + excluded.usd_micro`)
      .run(vault, now.toISOString().slice(0, 7), kind, Math.round(usdMicro));
  }

  usage(vault: string | null, month: string): { kind: string; calls: number; usd_micro: number }[] {
    return (vault
      ? this.db.prepare('SELECT kind, calls, usd_micro FROM usage WHERE vault = ? AND month = ? ORDER BY kind').all(vault, month)
      : this.db.prepare('SELECT kind, SUM(calls) AS calls, SUM(usd_micro) AS usd_micro FROM usage WHERE month = ? GROUP BY kind ORDER BY kind').all(month)) as never;
  }

  // ---------------------------------------------------------------- device tokens (D101): the hash only
  addDeviceToken(h: string, at: number) { this.db.prepare('INSERT OR IGNORE INTO device_tokens (h, created) VALUES (?, ?)').run(h, at); }
  hasDeviceToken(h: string): boolean { return !!this.db.prepare('SELECT 1 FROM device_tokens WHERE h = ?').get(h); }

  // ---------------------------------------------------------------- the concierge's log (D91): only with its own consent
  logConcierge(id: string, vault: string, ts: number, scenario: string, record: unknown) {
    this.db.prepare('INSERT INTO concierge_log (id, vault, ts, scenario, record) VALUES (?, ?, ?, ?, ?)').run(id, vault, ts, scenario, JSON.stringify(record));
  }
  /** What the person did with the answer — on the vault's own record only. */
  conciergeOutcome(vault: string, id: string, outcome: string, edit: unknown): boolean {
    return this.db.prepare('UPDATE concierge_log SET outcome = ?, edit = ? WHERE id = ? AND vault = ?')
      .run(outcome, edit === undefined ? null : JSON.stringify(edit), id, vault).changes > 0;
  }
  conciergeLog(vault: string): { id: string; ts: number; scenario: string; record: string; outcome: string | null; edit: string | null }[] {
    return this.db.prepare('SELECT id, ts, scenario, record, outcome, edit FROM concierge_log WHERE vault = ? ORDER BY ts DESC LIMIT 500').all(vault) as never;
  }
  deleteConciergeLog(vault: string): number { return Number(this.db.prepare('DELETE FROM concierge_log WHERE vault = ?').run(vault).changes); }
  purgeConcierge(before: number): number { return Number(this.db.prepare('DELETE FROM concierge_log WHERE ts < ?').run(before).changes); }
  conciergeBetween(from: number, to: number): { id: string; vault: string; ts: number; scenario: string; record: string; outcome: string | null; edit: string | null }[] {
    return this.db.prepare('SELECT id, vault, ts, scenario, record, outcome, edit FROM concierge_log WHERE ts >= ? AND ts < ? ORDER BY ts').all(from, to) as never;
  }

  // ---------------------------------------------------------------- D119: what the server can count without content
  /** The ISO weeks a vault came online in — a week, not a day or a time. */
  seen(vault: string, week: string) { this.db.prepare('INSERT OR IGNORE INTO vault_weeks (vault, week) VALUES (?, ?)').run(vault, week); }
  purgeSeen(before: string): number { return Number(this.db.prepare('DELETE FROM vault_weeks WHERE week < ?').run(before).changes); }
  /** Read-only queries of `stats:ops` and `stats:pilot`. */
  all<T>(sql: string, ...args: (string | number)[]): T[] { return this.db.prepare(sql).all(...args) as T[]; }

  // ---------------------------------------------------------------- the pilot (D119): by consent, not linked to vaults
  joinPilot(pid: string, secretHash: string, week: string) {
    this.db.prepare('INSERT INTO pilot_members (pid, secret_hash, joined) VALUES (?, ?, ?)').run(pid, secretHash, week);
  }
  pilotSecret(pid: string): string | undefined {
    return (this.db.prepare('SELECT secret_hash FROM pilot_members WHERE pid = ?').get(pid) as { secret_hash: string } | undefined)?.secret_hash;
  }
  /** A repeat of the same week and kind replaces the record. */
  putPilotWeek(pid: string, week: string, kind: string, src: string | null, body: string) {
    this.db.prepare(`INSERT INTO pilot_weeks (pid, week, kind, src, body) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (pid, week, kind) DO UPDATE SET src = excluded.src, body = excluded.body`).run(pid, week, kind, src, body);
  }
  /** Everything of the participant and the participant: rows removed. */
  leavePilot(pid: string): number {
    this.db.exec('BEGIN');
    try {
      const n = Number(this.db.prepare('DELETE FROM pilot_weeks WHERE pid = ?').run(pid).changes);
      this.db.prepare('DELETE FROM pilot_members WHERE pid = ?').run(pid);
      this.db.exec('COMMIT');
      return n;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  /** 12 months: older weeks go, and a member with nothing left who joined before then. */
  purgePilot(before: string): number {
    const n = Number(this.db.prepare('DELETE FROM pilot_weeks WHERE week < ?').run(before).changes);
    this.db.prepare('DELETE FROM pilot_members WHERE joined < ? AND pid NOT IN (SELECT pid FROM pilot_weeks)').run(before);
    return n;
  }
  pilotSource(code: string): string | undefined {
    return (this.db.prepare('SELECT label FROM pilot_sources WHERE code = ?').get(code) as { label: string } | undefined)?.label;
  }
  putPilotSource(code: string, label: string, issued: string) {
    this.db.prepare('INSERT INTO pilot_sources (code, label, issued) VALUES (?, ?, ?) ON CONFLICT (code) DO UPDATE SET label = excluded.label')
      .run(code, label, issued);
  }

  /** A consistent copy of the live database (D36: nightly backups). */
  backupTo(path: string) { return backup(this.db, path); }

  close() { this.db.close(); }
}
