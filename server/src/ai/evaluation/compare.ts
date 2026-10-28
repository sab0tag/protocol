import type { EvalCase } from './datasets.ts';
import { aggregate, scoreCase, type Aggregate, type CaseMetrics, type Extracted } from './metrics.ts';

export type EvalReader = (c: EvalCase) => Promise<{ result: Extracted | 'refused'; costUsd?: number }>;

export interface ModelReport {
  model: string;
  metrics: Aggregate;
  perCase: Record<string, CaseMetrics>;
  /** Average cost and latency per document — reported, never used to admit a model. */
  costPerDocumentUsd: number;
  msPerDocument: number;
  failures: string[];
}

export class NonSyntheticDatasetError extends Error {}

export async function evaluateModel(model: string, read: EvalReader, dataset: readonly EvalCase[],
  clock: () => number = Date.now): Promise<ModelReport> {
  if (dataset.some((c) => c.synthetic !== true)) throw new NonSyntheticDatasetError('Evaluation accepts synthetic documents only');
  const perCase: Record<string, CaseMetrics> = {};
  const failures: string[] = [];
  let cost = 0, ms = 0;
  for (const c of dataset) {
    const t0 = clock();
    try {
      const r = await read(c);
      cost += r.costUsd ?? 0;
      perCase[c.id] = scoreCase(c.expected, r.result);
    } catch {
      failures.push(c.id);
      perCase[c.id] = scoreCase(c.expected, 'refused'); // a crash is a missed document, not a skipped one
    }
    ms += clock() - t0;
  }
  const n = Math.max(1, dataset.length);
  return { model, metrics: aggregate(Object.values(perCase)), perCase, costPerDocumentUsd: cost / n, msPerDocument: ms / n, failures };
}

export interface Thresholds { name: number; dose: number; frequency: number; maxManualFixRate: number }
export const MEDICAL_THRESHOLDS: Thresholds = { name: 0.95, dose: 0.98, frequency: 0.95, maxManualFixRate: 0.3 };

export interface Admission { admitted: boolean; reasons: string[] }

/** A model reads medical documents only if it has no critical error and does not regress against the current route. Price is not a criterion. */
export function admit(candidate: ModelReport, baseline?: ModelReport, t: Thresholds = MEDICAL_THRESHOLDS): Admission {
  const m = candidate.metrics, reasons: string[] = [];
  if (m.critical > 0) reasons.push(`critical errors: ${m.critical}`);
  if (candidate.failures.length) reasons.push(`failed documents: ${candidate.failures.join(', ')}`);
  if (m.nameAccuracy < t.name) reasons.push('name accuracy below threshold');
  if (m.doseAccuracy < t.dose) reasons.push('dose accuracy below threshold');
  if (m.frequencyAccuracy < t.frequency) reasons.push('frequency accuracy below threshold');
  if (m.manualFixRate > t.maxManualFixRate) reasons.push('too many documents need manual correction');
  if (baseline) {
    const b = baseline.metrics;
    if (m.invented > b.invented) reasons.push('more invented prescriptions than the current route');
    if (m.missed > b.missed) reasons.push('more missed prescriptions than the current route');
    if (m.doseAccuracy < b.doseAccuracy) reasons.push('dose accuracy regressed against the current route');
  }
  return { admitted: reasons.length === 0, reasons };
}

export async function compareModels(readers: Readonly<Record<string, EvalReader>>, dataset: readonly EvalCase[],
  baselineModel: string): Promise<{ reports: ModelReport[]; admissions: Record<string, Admission> }> {
  const reports = [];
  for (const [model, read] of Object.entries(readers)) reports.push(await evaluateModel(model, read, dataset));
  const baseline = reports.find((r) => r.model === baselineModel);
  const admissions: Record<string, Admission> = {};
  for (const r of reports) admissions[r.model] = admit(r, r.model === baselineModel ? undefined : baseline);
  return { reports, admissions };
}
