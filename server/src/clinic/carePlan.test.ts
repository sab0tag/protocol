import { describe, expect, it } from 'vitest';
import { CarePlanV1, validateCarePlanV1 } from './carePlan.ts';

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

describe('D179: a rehabilitation complex in the plan', () => {
  const base = { schemaVersion: 1, planId: crypto.randomUUID(), organizationId: 'org', issuedAt: '2026-11-19T10:00:00Z',
    clinician: { displayName: 'Реабілітолог', organizationName: 'Клініка' }, title: 'Після перелому', medications: [], restrictions: [], tests: [] };
  it('optional; when present — perDay 1–10 and the text, nothing else', () => {
    expect(CarePlanV1.safeParse(base).success).toBe(true);
    expect(CarePlanV1.safeParse({ ...base, rehab: { perDay: 3, text: 'Згинання стопи | 3 × 10' } }).success).toBe(true);
    for (const rehab of [{ perDay: 0, text: 'x' }, { perDay: 11, text: 'x' }, { perDay: 2, text: '' }, { perDay: 2, text: 'x', stage: 2 }]) expect(CarePlanV1.safeParse({ ...base, rehab }).success).toBe(false);
  });
});
