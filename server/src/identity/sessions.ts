import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { immediate } from '../db/tx.ts';

/** TZ §4.2: idle 30 minutes, absolute 12 hours; a sign-in attempt lives 10 minutes; step-up is fresh for 10 minutes. */
export const IDLE_MS = 30 * 60_000;
export const ABSOLUTE_MS = 12 * 3600_000;
export const ATTEMPT_MS = 10 * 60_000;
export const RECENT_MS = 10 * 60_000;
const TOUCH_MS = 60_000; // last_seen is written at most once a minute per session

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

export interface Session {
  hash: string; accountId: string; issuer: string; createdAt: number; expiresAt: number; authTime: number; mfa: boolean; csrf: string;
}
export interface Attempt { purpose: 'login' | 'step_up'; sessionHash: string | null; returnTo: string; nonce: string; codeVerifier: string; state: string }
export type AttemptFailure = 'missing' | 'expired' | 'used' | 'mismatch';
export type SignInDenial = 'disabled' | 'not_linked' | 'account_mismatch' | 'session_gone';

/** Clinic staff need a completed MFA challenge before any clinical operation (TZ §4.2). ACCESS-04 applies this when it
 *  turns a session into a clinic membership subject; a session without MFA can still see its own account. */
export const clinicalAccess = (s: Session): 'ok' | 'mfa_required' => (s.mfa ? 'ok' : 'mfa_required');

/** Authentication is recent enough for a sensitive operation (role change, binding, grant, deletion). */
export const isRecent = (s: Session, now: number) => s.authTime > 0 && now - s.authTime <= RECENT_MS;

/**
 * Server sessions and sign-in attempts (ACCESS-03). The browser holds random secrets in Secure/HttpOnly cookies; the
 * database holds their hashes. Every protected request re-reads the session and the account, so a revoke, logout or a
 * disabled account takes effect on the next request whatever the cookie says. Fails closed.
 */
export class Sessions {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(db: DatabaseSync, now: () => number = Date.now) { this.db = db; this.now = now; }

  /** A new sign-in attempt. State, nonce and PKCE verifier stay here; the caller sets only `attemptId` as a cookie. */
  startAttempt(p: { purpose: 'login' | 'step_up'; sessionHash: string | null; returnTo: string; state: string; nonce: string; codeVerifier: string }): string {
    const attemptId = secret(), t = this.now();
    this.db.prepare(`INSERT INTO login_attempts (id_hash, state_hash, nonce, code_verifier, purpose, session_hash, return_to, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(hash(attemptId), hash(p.state), p.nonce, p.codeVerifier, p.purpose, p.sessionHash, p.returnTo, t, t + ATTEMPT_MS);
    return attemptId;
  }

  /** Consumes the attempt bound to this browser (cookie) and this callback (state). One use, even when it fails later. */
  takeAttempt(attemptId: string | undefined, state: string | undefined): Attempt | AttemptFailure {
    if (!attemptId || !state) return 'missing';
    return immediate(this.db, () => {
      const row = this.db.prepare('SELECT state_hash, nonce, code_verifier, purpose, session_hash, return_to, expires_at, used_at FROM login_attempts WHERE id_hash = ?')
        .get(hash(attemptId)) as { state_hash: string; nonce: string; code_verifier: string; purpose: 'login' | 'step_up'; session_hash: string | null;
          return_to: string; expires_at: number; used_at: number | null } | undefined;
      if (!row) return 'missing';
      if (row.used_at !== null) return 'used';
      this.db.prepare('UPDATE login_attempts SET used_at = ?, nonce = \'\', code_verifier = \'\' WHERE id_hash = ?').run(this.now(), hash(attemptId));
      if (row.expires_at <= this.now()) return 'expired';
      if (row.state_hash !== hash(state)) return 'mismatch'; // another browser's or a forged callback
      return { purpose: row.purpose, sessionHash: row.session_hash, returnTo: row.return_to, nonce: row.nonce, codeVerifier: row.code_verifier, state };
    });
  }

  /**
   * A verified sign-in becomes a new session. The account is found by exact (issuer, subject) only; an unknown identity
   * gets a new active Account without any membership — it carries no clinical rights. Never merges by email or name.
   * A session already in this browser (`replacing`) is revoked: a new id after every sign-in (no fixation).
   */
  signIn(p: { issuer: string; subject: string; authTime: number; mfa: boolean; replacing: string | null }): { token: string; session: Session } | SignInDenial {
    const t = this.now();
    const out = immediate(this.db, () => {
      if (p.replacing) this.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL').run(t, p.replacing);
      const known = this.db.prepare(`SELECT a.id, a.status FROM external_identities e JOIN accounts a ON a.id = e.account_id
        WHERE e.issuer = ? AND e.subject = ?`).get(p.issuer, p.subject) as { id: string; status: string } | undefined;
      let accountId: string;
      if (known) {
        if (known.status === 'disabled') { this.audit(known.id, 'login', 'disabled'); return 'disabled' as const; }
        if (known.status !== 'active') { this.audit(known.id, 'login', 'not_linked'); return 'not_linked' as const; }
        accountId = known.id;
      } else {
        accountId = randomUUID();
        this.db.prepare("INSERT INTO accounts (id, status, created_at) VALUES (?, 'active', ?)").run(accountId, t);
        this.db.prepare('INSERT INTO external_identities (issuer, subject, account_id, created_at) VALUES (?, ?, ?, ?)').run(p.issuer, p.subject, accountId, t);
        this.audit(accountId, 'account.create', 'ok');
      }
      const created = this.insert(accountId, p.issuer, p.authTime, p.mfa, t + ABSOLUTE_MS);
      this.audit(accountId, 'login', p.mfa ? 'ok_mfa' : 'ok');
      return created;
    });
    return out;
  }

  /**
   * A fresh authentication for the same person: the verified identity must belong to the session's account, otherwise
   * nothing changes. The session is replaced by a new id with the new auth_time/MFA; its absolute end is kept.
   */
  stepUp(p: { sessionHash: string; issuer: string; subject: string; authTime: number; mfa: boolean }): { token: string; session: Session } | SignInDenial {
    const t = this.now();
    return immediate(this.db, () => {
      const s = this.db.prepare('SELECT account_id, expires_at FROM sessions WHERE id_hash = ? AND revoked_at IS NULL AND expires_at > ?')
        .get(p.sessionHash, t) as { account_id: string; expires_at: number } | undefined;
      if (!s) return 'session_gone' as const;
      const owner = this.db.prepare(`SELECT a.id, a.status FROM external_identities e JOIN accounts a ON a.id = e.account_id
        WHERE e.issuer = ? AND e.subject = ?`).get(p.issuer, p.subject) as { id: string; status: string } | undefined;
      if (!owner || owner.id !== s.account_id) { this.audit(s.account_id, 'step_up', 'account_mismatch'); return 'account_mismatch' as const; }
      if (owner.status !== 'active') { this.audit(owner.id, 'step_up', 'disabled'); return 'disabled' as const; }
      this.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?').run(t, p.sessionHash);
      const created = this.insert(owner.id, p.issuer, p.authTime, p.mfa, s.expires_at);
      this.audit(owner.id, 'step_up', p.mfa ? 'ok_mfa' : 'ok');
      return created;
    });
  }

  /** The live session behind a cookie, or null: unknown, revoked, idle, past its absolute end, or the account not active. */
  authenticate(token: string | undefined): Session | null {
    if (!token || token.length > 100) return null;
    const t = this.now();
    const row = this.db.prepare(`SELECT s.id_hash, s.account_id, s.issuer, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at, s.auth_time, s.mfa, s.csrf,
      a.status FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.id_hash = ?`).get(hash(token)) as
      { id_hash: string; account_id: string; issuer: string; created_at: number; last_seen_at: number; expires_at: number; revoked_at: number | null;
        auth_time: number; mfa: number; csrf: string; status: string } | undefined;
    if (!row || row.revoked_at !== null || row.expires_at <= t || t - row.last_seen_at > IDLE_MS || row.status !== 'active') return null;
    if (t - row.last_seen_at >= TOUCH_MS) this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ? AND revoked_at IS NULL').run(t, row.id_hash);
    return { hash: row.id_hash, accountId: row.account_id, issuer: row.issuer, createdAt: row.created_at, expiresAt: row.expires_at,
      authTime: row.auth_time, mfa: row.mfa === 1, csrf: row.csrf };
  }

  hashOf(token: string | undefined): string | null { return token && token.length <= 100 ? hash(token) : null; }

  revoke(s: Session): void {
    immediate(this.db, () => {
      this.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL').run(this.now(), s.hash);
      this.audit(s.accountId, 'logout', 'ok');
    });
  }

  revokeAll(accountId: string): number {
    return immediate(this.db, () => {
      const r = this.db.prepare('UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL').run(this.now(), accountId);
      this.audit(accountId, 'revoke_all', String(r.changes));
      return Number(r.changes);
    });
  }

  /** Clinic contexts the account may choose (ACCESS-04 selects one). A listing, not authority: services ask the policy. */
  contexts(accountId: string): { membershipId: string; organizationId: string; organizationName: string; roles: string[] }[] {
    const rows = this.db.prepare(`SELECT m.id, m.organization_id, o.name FROM organization_memberships m JOIN clinic_orgs o ON o.id = m.organization_id
      JOIN accounts a ON a.id = m.account_id WHERE m.account_id = ? AND m.status = 'active' AND a.status = 'active' ORDER BY o.name, m.id`)
      .all(accountId) as { id: string; organization_id: string; name: string }[];
    return rows.map((r) => ({ membershipId: r.id, organizationId: r.organization_id, organizationName: r.name,
      roles: (this.db.prepare('SELECT role FROM organization_membership_roles WHERE membership_id = ? ORDER BY role').all(r.id) as { role: string }[]).map((x) => x.role) }));
  }

  /** Records a refused callback before any account is known. Categories only. */
  refused(action: string, result: string): void { this.audit(null, action, result); }

  /** Hourly: spent attempts, long-ended sessions and audit past the pilot's 180 days. */
  housekeeping(): void {
    const t = this.now();
    this.db.prepare('DELETE FROM login_attempts WHERE expires_at < ?').run(t - 3600_000);
    this.db.prepare('DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR expires_at < ?').run(t - 7 * 86_400_000, t - 7 * 86_400_000);
    this.db.prepare('DELETE FROM auth_audit WHERE at < ?').run(t - 180 * 86_400_000);
  }

  private insert(accountId: string, issuer: string, authTime: number, mfa: boolean, expiresAt: number): { token: string; session: Session } {
    const token = secret(), csrf = secret(), t = this.now();
    this.db.prepare(`INSERT INTO sessions (id_hash, account_id, issuer, created_at, last_seen_at, expires_at, auth_time, mfa, csrf)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(hash(token), accountId, issuer, t, t, expiresAt, authTime, mfa ? 1 : 0, csrf);
    return { token, session: { hash: hash(token), accountId, issuer, createdAt: t, expiresAt, authTime, mfa, csrf } };
  }

  private audit(accountId: string | null, action: string, result: string): void {
    this.db.prepare('INSERT INTO auth_audit (at, account_id, action, result) VALUES (?, ?, ?, ?)').run(this.now(), accountId, action, result);
  }
}
