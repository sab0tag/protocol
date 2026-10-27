import { describe, expect, it } from 'vitest';
import { assertPlanCatalog, expandLegacyPlan, plansForPerson, type PlanCatalog } from '../../src/domain/carePlans';
import { emptyPlan } from '../../src/data/seed.example';
import type { Plan } from '../../src/domain/types';
const legacy = (): Plan => ({ ...emptyPlan(),
  constraints: [{ id: 'same-id', tag: 'custom', title: 'Synthetic limit', reason: '', source: 'Source A', active: false }],
  prescriptions: [{ id: 'same-id', kind: 'medication', title: 'Synthetic instruction', dose: '1 таб.', source: 'Source B', schedule: { times: [] }, since: '2026-10-20' }],
  targets: { kcal: 2100, weightGoalKg: 80, fromDiet: { kcal: 'ЩД' } },
  modes: [{ id: 'mode', title: 'Synthetic mode', from: '2026-10-20', to: '2026-10-27', targetsOverride: { waterMl: 2000 }, notes: ['Keep source'] }],
  nextCheckup: { date: '2026-11-01', tests: ['Synthetic test'] }, profile: { heightCm: 180 }, questions: ['Keep question'],
});
describe('R5 separate source plan contracts', () => {
  it('expands deterministically without inferring source ownership, clock values or verification', () => {
    const input = legacy(), original = structuredClone(input);
    const a = expandLegacyPlan(input, 'main'), b = expandLegacyPlan(input, 'main');
    expect(a).toEqual(b); expect(input).toEqual(original);
    expect(a.legacySnapshot.record).toEqual(original);
    expect(a.plans).toHaveLength(1);
    expect(a.plans[0]).toMatchObject({ source: { kind: 'legacy', recordId: 'main' }, version: 1 });
    expect(a.plans[0]!.clinicianRef).toBeUndefined(); expect(a.plans[0]!.validFrom).toBeUndefined();
    expect(a.items).toHaveLength(6);
    expect(a.items.filter(item => item.content.type === 'target')).toHaveLength(2);
    expect(a.items.find(item => item.content.type === 'target' && item.content.key === 'kcal')?.content).toEqual({ type: 'target', key: 'kcal', value: 2100, referenceDiet: 'ЩД' });
    expect(a.items.every(item => item.provenance.verification === 'legacy')).toBe(true);
    expect(a.items.find(item => item.content.type === 'prescription')?.content).toEqual({ type: 'prescription', value: original.prescriptions[0] });
    expect(a.items.find(item => item.content.type === 'constraint')?.content).toEqual({ type: 'constraint', value: original.constraints[0] });
    expect(a.items.filter(item => item.provenance.text).map(item => item.provenance.text)).toEqual(['Source B', 'Source A']);
    input.prescriptions[0]!.title = 'Edited elsewhere';
    expect(a.legacySnapshot.record).toEqual(original);
    const instruction = a.items.find(item => item.content.type === 'prescription')!.content;
    if (instruction.type === 'prescription') instruction.value.title = 'Later item edit';
    expect(a.legacySnapshot.record).toEqual(original);
  });
  it('keeps two parallel source plans and their versions intact, even with identical instruction names', () => {
    const a = expandLegacyPlan(legacy(), 'main');
    const otherPlan = { ...a.plans[0]!, id: 'document-B', title: 'Second plan', version: 2, source: { kind: 'document' as const, documentId: 'doc-B' } };
    const otherItems = a.items.map(item => ({ ...item, id: `B:${item.id}`, planId: otherPlan.id, provenance: { ...item.provenance, text: 'Document B' } }));
    const catalog = { plans: [...a.plans, otherPlan], items: [...a.items, ...otherItems] };
    const projected = plansForPerson(catalog, 'main');
    expect(projected).toHaveLength(2);
    expect(projected.map(row => row.plan.version)).toEqual([1, 2]);
    expect(projected[0]!.items).toEqual(a.items); expect(projected[1]!.items).toEqual(otherItems);
    projected[0]!.plan.title = 'UI edit'; projected[0]!.items[0]!.provenance.text = 'UI edit';
    expect(catalog.plans[0]!.title).toBe('Поточний план'); expect(catalog.items[0]!.provenance.text).toBe('Source B');
  });
  it('scopes records by person and never joins another person by a colliding plan id', () => {
    const a = expandLegacyPlan(legacy(), 'main'), b = expandLegacyPlan(legacy(), 'relative');
    b.plans[0]!.id = a.plans[0]!.id;
    b.items.forEach(item => { item.planId = a.plans[0]!.id; });
    const catalog: PlanCatalog = { plans: [...a.plans, ...b.plans], items: [...a.items, ...b.items] };
    expect(plansForPerson(catalog, 'main')).toEqual([{ plan: a.plans[0], items: a.items }]);
    expect(plansForPerson(catalog, 'unknown')).toEqual([]);
    expect(() => assertPlanCatalog({ plans: a.plans, items: b.items })).toThrow('plan_item_owner_mismatch');
  });
  it('preserves draft/paused/completed/archive states instead of reactivating through projection', () => {
    const a = expandLegacyPlan(legacy(), 'main');
    for (const status of ['draft', 'paused', 'completed', 'archived'] as const) {
      a.plans[0]!.status = status;
      expect(plansForPerson(a, 'main')[0]!.plan.status).toBe(status);
    }
  });
  it('rejects colliding identities rather than dropping one instruction', () => {
    const input = legacy(); input.prescriptions.push({ ...input.prescriptions[0]! });
    expect(() => expandLegacyPlan(input, 'main')).toThrow('plan_item_identity_collision');
    const a = expandLegacyPlan(legacy(), 'main');
    expect(() => assertPlanCatalog({ plans: [...a.plans, ...a.plans], items: a.items })).toThrow('plan_identity_collision');
    a.plans[0]!.version = 0; expect(() => assertPlanCatalog(a)).toThrow('plan_version_invalid');
    expect(() => expandLegacyPlan(legacy(), '')).toThrow('plan_identity_required');
  });
});
