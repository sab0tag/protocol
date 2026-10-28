/** Pre-flight AI spend control (spec §5). Amounts are integer micro-USD; no network, no medical content. */

export type BudgetScope = string;

export interface BudgetLimit {
  scope: BudgetScope;
  /** Ceiling for committed + reserved spend in the current window. */
  limit: number;
}

export type ReserveOutcome =
  | { ok: true; operationId: string; reserved: number; replay: boolean; warnings: BudgetScope[] }
  | { ok: false; reason: 'over_budget' | 'operation_cap' | 'feature_disabled'; scope?: BudgetScope };

interface Entry { scopes: BudgetScope[]; reserved: number; committed: number | null }

/**
 * Synchronous check-and-reserve: in a single JS turn no other request can interleave,
 * so concurrent callers cannot jointly exceed a limit. A persistent store must keep the same
 * guarantee with one transaction.
 */
export class BudgetGuard {
  private readonly limits = new Map<BudgetScope, number>();
  private readonly spent = new Map<BudgetScope, number>();
  private readonly ops = new Map<string, Entry>();
  private readonly disabled = new Set<string>();
  private readonly warnAt: number;
  private readonly perOperationCap: number;

  constructor(limits: readonly BudgetLimit[], options: { perOperationCap: number; warnAt?: number }) {
    for (const l of limits) this.limits.set(l.scope, l.limit);
    this.perOperationCap = options.perOperationCap;
    this.warnAt = options.warnAt ?? 0.8;
  }

  /** Register a window (e.g. `day:2026-10-28`) with its limit; `alreadySpent` seeds it from persisted spend the first time it is seen. */
  ensureScope(scope: BudgetScope, limit: number, alreadySpent: number): void {
    this.limits.set(scope, limit);
    if (!this.spent.has(scope)) this.spent.set(scope, alreadySpent);
  }

  disableFeature(task: string): void { this.disabled.add(task); }
  enableFeature(task: string): void { this.disabled.delete(task); }

  /** `scopes` are all budgets this operation draws on (global day/month, task, user, clinic). */
  reserve(operationId: string, task: string, upperBound: number, scopes: readonly BudgetScope[]): ReserveOutcome {
    const known = this.ops.get(operationId);
    if (known) return { ok: true, operationId, reserved: known.reserved, replay: true, warnings: [] };
    if (this.disabled.has(task)) return { ok: false, reason: 'feature_disabled' };
    if (!Number.isFinite(upperBound) || upperBound < 0 || upperBound > this.perOperationCap)
      return { ok: false, reason: 'operation_cap' };
    for (const s of scopes) {
      const limit = this.limits.get(s);
      if (limit !== undefined && (this.spent.get(s) ?? 0) + upperBound > limit)
        return { ok: false, reason: 'over_budget', scope: s };
    }
    const warnings: BudgetScope[] = [];
    for (const s of scopes) {
      const before = this.spent.get(s) ?? 0;
      const after = before + upperBound;
      this.spent.set(s, after);
      const limit = this.limits.get(s);
      if (limit !== undefined && limit > 0 && before < limit * this.warnAt && after >= limit * this.warnAt) warnings.push(s);
    }
    this.ops.set(operationId, { scopes: [...scopes], reserved: upperBound, committed: null });
    return { ok: true, operationId, reserved: upperBound, replay: false, warnings };
  }

  /** Record the real cost and release the unused part of the reservation. Repeating it changes nothing. */
  commit(operationId: string, actual: number): void {
    const e = this.ops.get(operationId);
    if (!e || e.committed !== null) return;
    const real = Math.max(0, actual);
    for (const s of e.scopes) this.spent.set(s, (this.spent.get(s) ?? 0) - e.reserved + real);
    e.committed = real;
  }

  /** A failed call before the provider billed anything gives the whole reservation back. */
  release(operationId: string): void {
    const e = this.ops.get(operationId);
    if (!e || e.committed !== null) return;
    for (const s of e.scopes) this.spent.set(s, (this.spent.get(s) ?? 0) - e.reserved);
    e.committed = 0;
  }

  used(scope: BudgetScope): number { return this.spent.get(scope) ?? 0; }
}
