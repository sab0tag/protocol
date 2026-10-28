import { createHash, randomBytes } from 'node:crypto';
import { validateCarePlanV1, type CarePlanV1 } from './carePlan.ts';

export type RedeemResult =
  | { ok: true; preview: CarePlanV1 }
  | { ok: false; reason: 'invalid_or_expired' };

interface StoredTransfer {
  readonly organizationId: string;
  readonly plan: CarePlanV1;
  readonly expiresAt: number;
}

/**
 * Prototype storage only. Production MUST use encrypted durable storage and an atomic
 * DELETE ... RETURNING / transaction across processes. Never log raw tokens or plans.
 */
export class InMemoryPlanTransfer {
  private readonly entries = new Map<string, StoredTransfer>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  issue(input: unknown, options: { organizationId: string; ttlMs: number }): { token: string; expiresAt: number } {
    const plan = validateCarePlanV1(input);
    if (!options.organizationId || options.organizationId !== plan.organizationId)
      throw new Error('Organization mismatch');
    if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs < 1 || options.ttlMs > 24 * 60 * 60 * 1000)
      throw new Error('Invalid expiry');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + options.ttlMs;
    this.entries.set(hashToken(token), { organizationId: options.organizationId, plan, expiresAt });
    return { token, expiresAt };
  }

  /** Consumes the token even if it has expired; no plan is returned on failure. */
  redeem(token: string): RedeemResult {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false, reason: 'invalid_or_expired' };
    const hash = hashToken(token);
    const entry = this.entries.get(hash);
    if (!entry) return { ok: false, reason: 'invalid_or_expired' };
    this.entries.delete(hash); // synchronous consume before returning preview
    if (entry.expiresAt <= this.now()) return { ok: false, reason: 'invalid_or_expired' };
    return { ok: true, preview: structuredClone(entry.plan) };
  }

  revoke(token: string): void {
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) this.entries.delete(hashToken(token));
  }

  purgeExpired(): number {
    let count = 0;
    for (const [hash, entry] of this.entries) {
      if (entry.expiresAt <= this.now()) { this.entries.delete(hash); count++; }
    }
    return count;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
