import { describe, expect, it } from 'vitest';
import { admit, compareModels, evaluateModel, NonSyntheticDatasetError, type EvalReader } from './compare.ts';
import { SYNTHETIC_DATASET, type EvalCase } from './datasets.ts';
import { scoreCase } from './metrics.ts';

const perfect: EvalReader = async (c) => ({ result: {
  prescriptions: c.expected.medications.map((m) => ({ ...m })),
  constraints: c.expected.constraints.map((k) => ({ ...k })),
}, costUsd: 0.05 });

describe('dataset', () => {
  it('covers the required scenario kinds and both languages, all synthetic', () => {
    const kinds = new Set(SYNTHETIC_DATASET.flatMap((c) => c.features));
    for (const k of ['simple', 'multi_drug', 'complex_dose', 'units', 'multi_intake', 'illegible', 'contradictory', 'multi_page'] as const) expect(kinds).toContain(k);
    expect(new Set(SYNTHETIC_DATASET.map((c) => c.language))).toEqual(new Set(['uk', 'en']));
    expect(SYNTHETIC_DATASET.every((c) => c.synthetic)).toBe(true);
  });
});

describe('metrics', () => {
  const want = { medications: [{ title: 'Тестол', dose: '500 мг', perDay: 2, durationDays: 14 }], constraints: [{ tag: 'allergy', allergens: ['milk'] }] };

  it('exact match has no errors', () => {
    const m = scoreCase(want, { prescriptions: [{ title: 'тестол', dose: '500 МГ', perDay: 2, durationDays: 14 }], constraints: [{ tag: 'allergy', allergens: ['milk'] }] });
    expect(m).toMatchObject({ matched: 1, doses: 1, missed: 0, invented: 0, critical: 0, needsManualFix: false });
  });

  it('counts missed, invented and wrong dose; wrong dose and invented lines are critical', () => {
    const m = scoreCase(want, { prescriptions: [{ title: 'Інший', dose: '1 мг', perDay: 1, durationDays: null }], constraints: [] });
    expect(m).toMatchObject({ missed: 1, invented: 1, constraintsWrong: 1, needsManualFix: true });
    expect(m.critical).toBe(2); // invented line + lost allergen
    const dosed = scoreCase(want, { prescriptions: [{ title: 'Тестол', dose: '50 мг', perDay: 2, durationDays: 14 }], constraints: [{ tag: 'allergy', allergens: ['milk'] }] });
    expect(dosed).toMatchObject({ doses: 0, critical: 1 });
  });

  it('a refusal is a fully missed document', () => {
    expect(scoreCase(want, 'refused')).toMatchObject({ missed: 1, needsManualFix: true });
  });
});

describe('evaluation and admission', () => {
  it('admits a faithful model', async () => {
    const r = await evaluateModel('good', perfect, SYNTHETIC_DATASET);
    expect(r.metrics).toMatchObject({ nameAccuracy: 1, doseAccuracy: 1, critical: 0, manualFixRate: 0 });
    expect(r.costPerDocumentUsd).toBeCloseTo(0.05);
    expect(admit(r)).toEqual({ admitted: true, reasons: [] });
  });

  it('does not admit a cheap model with a critical error, and says why', async () => {
    const cheap: EvalReader = async (c) => {
      const r = await perfect(c);
      if (r.result !== 'refused' && c.id === 'multi-drug-uk') r.result.prescriptions.push({ title: 'Вигаданий', dose: '1 мг', perDay: 1, durationDays: null });
      return { ...r, costUsd: 0.001 };
    };
    const { reports, admissions } = await compareModels({ current: perfect, cheap }, SYNTHETIC_DATASET, 'current');
    expect(reports.find((x) => x.model === 'cheap')!.costPerDocumentUsd).toBeLessThan(reports[0]!.costPerDocumentUsd);
    expect(admissions['cheap']!.admitted).toBe(false);
    expect(admissions['cheap']!.reasons.join()).toMatch(/critical/);
    expect(admissions['current']!.admitted).toBe(true);
  });

  it('counts a crashing reader as failed documents', async () => {
    const r = await evaluateModel('broken', async () => { throw new Error('down'); }, SYNTHETIC_DATASET);
    expect(r.failures).toHaveLength(SYNTHETIC_DATASET.length);
    expect(admit(r).admitted).toBe(false);
  });

  it('refuses a dataset that is not marked synthetic', async () => {
    const real = [{ ...SYNTHETIC_DATASET[0]!, synthetic: false } as unknown as EvalCase];
    await expect(evaluateModel('x', perfect, real)).rejects.toBeInstanceOf(NonSyntheticDatasetError);
  });
});
