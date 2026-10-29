import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { immediate } from '../db/tx.ts';
import { IdentityError } from './errors.ts';

export const secret = () => randomBytes(32).toString('base64url');
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const IDLE_MS = 30 * 60_000, ABSOLUTE_MS = 12 * 60 * 60_000, FRESH_MS = 10 * 60_000;
export interface VerifiedIdentity { issuer: string; subject: string; authTime: number; mfa: boolean }
export interface Session { id_hash: string; account_id: string; csrf_secret: string; created_at: number; last_seen_at: number;
  expires_at: number; auth_time: number; mfa: number; revoked_at: number | null }
export interface Attempt { nonce: string; verifier: string; prior_session_hash: string | null }

export class Sessions {
  readonly db: DatabaseSync;
  readonly now: () => number;
  constructor(db: DatabaseSync, now: () => number = Date.now) { this.db = db; this.now = now; }

  begin(nonce: string, verifier: string, prior?: Session): { state: string; browser: string } {
    const state = secret(), browser = secret(), at = this.now();
    immediate(this.db, () => {
      this.db.prepare('DELETE FROM identity_login_attempts WHERE expires_at <= ? OR consumed_at IS NOT NULL').run(at);
      this.db.prepare('INSERT INTO identity_login_attempts VALUES (?, ?, ?, ?, ?, ?, NULL)')
        .run(digest(state), digest(browser), nonce, verifier, at + 5 * 60_000, prior?.id_hash ?? null);
    });
    return { state, browser };
  }

  /** Claim before network I/O: one callback attempt only, including failed provider exchanges. */
  claim(state: string, browser: string): Attempt {
    if (!/^[\w-]{43}$/.test(state) || !/^[\w-]{43}$/.test(browser)) throw new IdentityError('invalid_login');
    return immediate(this.db, () => {
      const row = this.db.prepare('SELECT * FROM identity_login_attempts WHERE state_hash = ? AND browser_hash = ? AND consumed_at IS NULL AND expires_at > ?')
        .get(digest(state), digest(browser), this.now()) as (Attempt & { expires_at: number }) | undefined;
      if (!row) throw new IdentityError('invalid_login');
      this.db.prepare("UPDATE identity_login_attempts SET consumed_at = ?, nonce = '', verifier = '' WHERE state_hash = ?").run(this.now(), digest(state));
      return { nonce: row.nonce, verifier: row.verifier, prior_session_hash: row.prior_session_hash };
    });
  }

  /** No name/email/token-based linking. Only the verified issuer+subject can select an identity. */
  establish(identity: VerifiedIdentity, priorHash: string | null): { token: string; session: Session } {
    const at = this.now();
    if (!identity.issuer || !identity.subject || !Number.isSafeInteger(identity.authTime) || identity.authTime > at || at - identity.authTime > FRESH_MS) {
      throw new IdentityError('invalid_login');
    }
    const token = secret(), csrf = secret(), h = digest(token);
    return immediate(this.db, () => {
      const existing = this.db.prepare('SELECT account_id FROM external_identities WHERE issuer = ? AND subject = ?')
        .get(identity.issuer, identity.subject) as { account_id: string } | undefined;
      let account = existing?.account_id;
      if (!account) {
        if (priorHash) throw new IdentityError('invalid_login'); // step-up cannot switch or create an identity
        account = randomUUID();
        this.db.prepare("INSERT INTO accounts VALUES (?, 'active', ?)").run(account, at);
        this.db.prepare('INSERT INTO external_identities VALUES (?, ?, ?, ?)').run(identity.issuer, identity.subject, account, at);
      }
      const status = this.db.prepare('SELECT status FROM accounts WHERE id = ?').get(account)?.status;
      if (status !== 'active') throw new IdentityError('unauthorized');
      if (priorHash) {
        const prior = this.require(priorHash);
        if (prior.account_id !== account) throw new IdentityError('invalid_login');
        this.db.prepare('UPDATE identity_sessions SET revoked_at = ? WHERE id_hash = ?').run(at, priorHash);
      }
      // Drop provider tokens: only verified claims above are persisted. A login never creates clinic membership.
      this.db.prepare('INSERT INTO identity_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)')
        .run(h, account, csrf, at, at, at + ABSOLUTE_MS, identity.authTime, identity.mfa ? 1 : 0);
      this.audit(account, priorHash ? 'step_up' : 'login');
      return { token, session: this.require(h) };
    });
  }

  /** Live check at service boundaries, including inside callers' write transactions. Does not extend idle time. */
  require(hash: string, options: { mfa?: boolean; fresh?: boolean } = {}): Session {
    const at = this.now();
    const row = this.db.prepare(`SELECT s.* FROM identity_sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.id_hash = ? AND a.status = 'active'`).get(hash) as unknown as Session | undefined;
    if (!row || row.revoked_at !== null || row.expires_at <= at || row.last_seen_at + IDLE_MS <= at || row.created_at > at) throw new IdentityError('unauthorized');
    if (options.mfa && row.mfa !== 1) throw new IdentityError('mfa_required');
    if (options.fresh && (row.auth_time > at || row.auth_time + FRESH_MS < at)) throw new IdentityError('step_up_required');
    return row;
  }

  authenticate(token: string | undefined): Session {
    if (!token || !/^[\w-]{43}$/.test(token)) throw new IdentityError('unauthorized');
    return immediate(this.db, () => {
      const row = this.require(digest(token));
      this.db.prepare('UPDATE identity_sessions SET last_seen_at = ? WHERE id_hash = ?').run(this.now(), row.id_hash);
      return { ...row, last_seen_at: this.now() };
    });
  }

  csrf(session: Session, token: string | undefined, origin: string | undefined, expectedOrigin: string): void {
    if (origin !== expectedOrigin || !token || !/^[\w-]{43}$/.test(token) || token.length !== session.csrf_secret.length ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(session.csrf_secret))) throw new IdentityError('forbidden');
  }

  revoke(hash: string, all: boolean): void {
    immediate(this.db, () => {
      const row = this.require(hash);
      this.db.prepare(all ? 'UPDATE identity_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL'
        : 'UPDATE identity_sessions SET revoked_at = ? WHERE id_hash = ?').run(this.now(), all ? row.account_id : hash);
      this.audit(row.account_id, all ? 'revoke_all' : 'logout');
    });
  }

  contexts(accountId: string): { membershipId: string; organizationId: string; organizationName: string; roles: string[] }[] {
    const rows = this.db.prepare(`SELECT m.id, m.organization_id, o.name FROM organization_memberships m
      JOIN accounts a ON a.id = m.account_id JOIN clinic_orgs o ON o.id = m.organization_id
      WHERE m.account_id = ? AND m.status = 'active' AND a.status = 'active' ORDER BY m.id`).all(accountId) as { id: string; organization_id: string; name: string }[];
    return rows.map(r => ({ membershipId: r.id, organizationId: r.organization_id, organizationName: r.name,
      roles: this.db.prepare('SELECT role FROM organization_membership_roles WHERE membership_id = ? ORDER BY role').all(r.id).map(x => String(x.role)) }));
  }

  cleanup(): void {
    immediate(this.db, () => {
      const at = this.now();
      this.db.prepare('DELETE FROM identity_login_attempts WHERE expires_at <= ? OR consumed_at IS NOT NULL').run(at);
      this.db.prepare('DELETE FROM identity_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL OR last_seen_at <= ?').run(at, at - IDLE_MS);
    });
  }

  denied(action: 'login_failed' | 'access_denied', hash?: string): void {
    const account = hash ? this.db.prepare('SELECT account_id FROM identity_sessions WHERE id_hash = ?').get(hash)?.account_id : null;
    this.audit(typeof account === 'string' ? account : null, action);
  }

  private audit(account: string | null, action: string): void {
    this.db.prepare('INSERT INTO identity_audit (at, account_id, action) VALUES (?, ?, ?)').run(this.now(), account, action);
  }
}
