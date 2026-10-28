import { describe, expect, it } from 'vitest';
import { validateCarePlanV1 } from './carePlan.ts';

const valid = {
  schemaVersion: 1,
  planId: '3b44a93e-31a2-42e6-b2a1-6b0dd40f4f5e',
  organizationId: 'clinic-demo',
  issuedAt: '2026-10-28T10:00:00Z',
  clinician: { displayName: 'Demo Doctor', organizationName: 'Demo Clinic' },
  title: 'Synthetic plan',
  medications: [{ name: 'Synthetic A', dose: '1 unit', frequency: 'once daily', duration: '7 days', instructions: '' }],
  restrictions: [], tests: [],
};

describe('Care Plan v1 exchange contract', () => {
  it('accepts a complete synthetic plan', () => {
    expect(validateCarePlanV1(valid).schemaVersion).toBe(1);
  });
  it('rejects unknown fields to avoid silent loss of data', () => {
    expect(() => validateCarePlanV1({ ...valid, hidden: 'unexpected' })).toThrow();
  });
  it('rejects missing medication dose', () => {
    expect(() => validateCarePlanV1({ ...valid, medications: [{ name: 'Synthetic A', frequency: 'once daily', duration: '', instructions: '' }] })).toThrow();
  });
});
