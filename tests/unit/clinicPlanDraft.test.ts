import { describe, expect, it } from 'vitest';
import { composePlan, patientLink } from '../../src/domain/clinicPlanDraft';
import { previewClinicPlan } from '../../src/domain/planImport';

const who = { organizationId: 'org-1', organizationName: 'Клініка', displayName: 'Др. Іваненко' };
const form = { title: 'План', medications: 'Ліки | 1 таб. | 2 рази | 7 днів | після їжі | запити водою', restrictions: 'Без алкоголю\n\n', tests: '', followUp: '' };
const id = () => '11111111-1111-4111-8111-111111111111';

describe('composePlan', () => {
  it('builds a plan the patient app accepts, using the doctor\'s own identity', () => {
    const r = composePlan(form, who, id, () => new Date('2026-10-28T10:00:00Z'));
    if (!('plan' in r)) throw new Error('expected a plan');
    expect(r.plan).toMatchObject({ organizationId: 'org-1', clinician: { displayName: 'Др. Іваненко', organizationName: 'Клініка' } });
    expect(r.plan.medications[0]).toEqual({ name: 'Ліки', dose: '1 таб.', frequency: '2 рази', duration: '7 днів', instructions: 'після їжі | запити водою' });
    expect(previewClinicPlan(r.plan)!.items).toHaveLength(2);
  });
  it('refuses a missing title, an incomplete medication and an empty plan', () => {
    expect(composePlan({ ...form, title: ' ' }, who)).toEqual({ error: 'title' });
    expect(composePlan({ ...form, medications: 'Ліки | 1 таб.' }, who)).toEqual({ error: 'medication' });
    expect(composePlan({ ...form, medications: '', restrictions: '' }, who)).toEqual({ error: 'empty' });
  });
  it('refuses what the server would refuse (too long)', () => {
    expect(composePlan({ ...form, title: 'x'.repeat(201) }, who)).toEqual({ error: 'invalid' });
  });
});

describe('patientLink', () => {
  it('keeps the code in the fragment, never in the path or query', () => {
    const l = patientLink('https://app.test/', 'a_b-c');
    expect(l).toBe('https://app.test/#/plan/import?code=a_b-c');
    expect(new URL(l).search).toBe('');
  });
});
