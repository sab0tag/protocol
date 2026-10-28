import { afterEach, describe, expect, it } from 'vitest';
import { ProtocolDB } from '../../src/data/db';
import { readPreparedPlans, saveClinicImport } from '../../src/data/carePlans';
import { profileDatabase } from '../../src/data/profiles';
import { confirmImport, parseClinicPlan, previewClinicPlan } from '../../src/domain/planImport';

const plan = () => ({
  schemaVersion: 1, planId: '11111111-1111-4111-8111-111111111111', organizationId: 'org', issuedAt: '2026-10-01T10:00:00+03:00',
  clinician: { displayName: 'Лікар', organizationName: 'Клініка' }, title: 'План',
  medications: [{ name: 'Ліки', dose: '1 таб.', frequency: '2 рази', duration: '7 днів', instructions: 'після їжі' }],
  restrictions: ['Без алкоголю'], tests: ['Загальний аналіз крові'], followUp: 'Візит за 2 тижні',
});
const dbs: ProtocolDB[] = [];
const make = () => { const personId = crypto.randomUUID(); const db = new ProtocolDB(profileDatabase(personId)); dbs.push(db); return { db, personId }; };
afterEach(async () => { for (const d of dbs.splice(0)) await d.delete(); });

describe('clinic plan import', () => {
  it('previews every item without storing or activating anything', () => {
    const pv = previewClinicPlan(plan())!;
    expect(pv.items.map((i) => i.key)).toEqual(['med:0', 'rest:0', 'test:0', 'follow']);
    expect(pv.items[0]!.detail).toBe('1 таб. · 2 рази · 7 днів · після їжі');
  });
  it('refuses malformed plans and unknown fields', () => {
    expect(parseClinicPlan(null)).toBeNull();
    expect(parseClinicPlan({ ...plan(), schemaVersion: 2 })).toBeNull();
    expect(parseClinicPlan({ ...plan(), extra: 1 })).toBeNull();
    expect(parseClinicPlan({ ...plan(), medications: [{ name: 'x' }] })).toBeNull();
    expect(parseClinicPlan({ ...plan(), issuedAt: 'not a date' })).toBeNull();
    expect(parseClinicPlan({ ...plan(), medications: [{ ...plan().medications[0], extra: 1 }] })).toBeNull();
  });
  it('imports only ticked items, as an unverified draft with its source, with no schedule or start date', () => {
    const pv = previewClinicPlan(plan())!, personId = 'p1';
    expect(confirmImport(pv, [], personId)).toBeNull();
    expect(confirmImport(pv, ['nope'], personId)).toBeNull();
    const d = confirmImport(pv, ['med:0', 'test:0'], personId)!;
    expect(d.plan).toMatchObject({ status: 'draft', source: { kind: 'clinic', organizationName: 'Клініка' } });
    expect(d.items).toHaveLength(2);
    for (const it of d.items) {
      expect(it.provenance.verification).toBe('pending');
      expect(it.content.type === 'prescription' && it.content.value.schedule).toBeFalsy();
      expect(it.content.type === 'prescription' && it.content.value.since).toBeFalsy();
    }
  });
  it('stores locally once; a second import of the same plan changes nothing', async () => {
    const { db, personId } = make();
    const d = confirmImport(previewClinicPlan(plan())!, ['med:0', 'rest:0'], personId)!;
    expect(await saveClinicImport(db, personId, d)).toBe('saved');
    expect(await saveClinicImport(db, personId, d)).toBe('already_imported');
    const stored = await readPreparedPlans(db, personId);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.items).toHaveLength(2);
  });
  it('refuses to write another person\'s plan', async () => {
    const { db, personId } = make();
    const d = confirmImport(previewClinicPlan(plan())!, ['med:0'], 'someone-else')!;
    await expect(saveClinicImport(db, personId, d)).rejects.toThrow('plan_database_owner_mismatch');
  });
});
