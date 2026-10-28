import { describe, expect, it } from 'vitest';
import { InMemoryPlanTransfer } from './transfer.ts';

const plan = {
  schemaVersion: 1, planId: '3b44a93e-31a2-42e6-b2a1-6b0dd40f4f5e',
  organizationId: 'demo-clinic', issuedAt: '2026-10-28T10:00:00Z',
  clinician: { displayName: 'Demo Doctor', organizationName: 'Demo Clinic' },
  title: 'Synthetic plan', medications: [], restrictions: [], tests: [],
};

describe('single-use clinic transfer prototype', () => {
  it('issues a random token and redeems exactly once', () => {
    const store = new InMemoryPlanTransfer(() => 1000);
    const { token } = store.issue(plan, { organizationId: 'demo-clinic', ttlMs: 60000 });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.redeem(token)).toMatchObject({ ok: true, preview: plan });
    expect(store.redeem(token)).toEqual({ ok: false, reason: 'invalid_or_expired' });
  });
  it('rejects cross-tenant issuance', () => {
    const store = new InMemoryPlanTransfer();
    expect(() => store.issue(plan, { organizationId: 'other', ttlMs: 1000 })).toThrow('Organization mismatch');
  });
  it('rejects expired tokens and purges expired records', () => {
    let now = 0;
    const store = new InMemoryPlanTransfer(() => now);
    const a = store.issue(plan, { organizationId: 'demo-clinic', ttlMs: 100 });
    const b = store.issue(plan, { organizationId: 'demo-clinic', ttlMs: 100 });
    now = 100;
    expect(store.redeem(a.token)).toEqual({ ok: false, reason: 'invalid_or_expired' });
    expect(store.purgeExpired()).toBe(1);
    expect(store.redeem(b.token).ok).toBe(false);
  });
  it('revokes transfers and rejects malformed tokens', () => {
    const store = new InMemoryPlanTransfer();
    const { token } = store.issue(plan, { organizationId: 'demo-clinic', ttlMs: 1000 });
    store.revoke(token);
    expect(store.redeem(token).ok).toBe(false);
    expect(store.redeem('not-a-token').ok).toBe(false);
  });
  it('does not expose internal plan reference after redemption', () => {
    const store = new InMemoryPlanTransfer();
    const { token } = store.issue(plan, { organizationId: 'demo-clinic', ttlMs: 1000 });
    const result = store.redeem(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      result.preview.title = 'Changed locally';
      expect(plan.title).toBe('Synthetic plan');
    }
  });
});
