/** Quality metrics for medical-document models (spec §6.3). Pure functions over synthetic data; no network. */

export interface ExpectedMedication {
  title: string;
  dose: string | null;
  perDay: number | null;
  durationDays: number | null;
}
export interface ExpectedConstraint { tag: string; allergens: string[] }
export interface Expected { medications: ExpectedMedication[]; constraints: ExpectedConstraint[] }

/** The subset of the app's `ConclusionResult` the evaluation reads. */
export interface Extracted {
  prescriptions: { title: string; dose: string | null; perDay: number | null; durationDays: number | null }[];
  constraints: { tag: string; allergens: string[] }[];
}

export interface CaseMetrics {
  expectedMedications: number;
  matched: number;
  names: number;
  doses: number;
  frequencies: number;
  durations: number;
  missed: number;
  invented: number;
  constraintsExpected: number;
  constraintsWrong: number;
  /** Errors that could harm a patient if not caught in review: an invented line, a wrong dose, a lost allergen. */
  critical: number;
  needsManualFix: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s.,;:()«»"'\-–]/g, '');
const dose = (s: string | null) => (s === null ? null : s.toLowerCase().replace(/\s+/g, '').replace(',', '.'));
const sameName = (a: string, b: string) => { const x = norm(a), y = norm(b); return x !== '' && y !== '' && (x === y || x.includes(y) || y.includes(x)); };

export function scoreCase(expected: Expected, got: Extracted | 'refused'): CaseMetrics {
  const out = got === 'refused' ? { prescriptions: [], constraints: [] } : got;
  const pool = [...out.prescriptions];
  let matched = 0, doses = 0, frequencies = 0, durations = 0, critical = 0, fixes = 0;
  let missed = 0;
  for (const want of expected.medications) {
    const i = pool.findIndex((p) => sameName(p.title, want.title));
    if (i < 0) { missed++; continue; }
    const have = pool.splice(i, 1)[0]!;
    matched++;
    if (dose(have.dose) === dose(want.dose)) doses++; else { critical++; fixes++; }
    if (have.perDay === want.perDay) frequencies++; else fixes++;
    if (have.durationDays === want.durationDays) durations++; else fixes++;
  }
  const invented = pool.length;
  critical += invented;

  let constraintsWrong = 0;
  const left = [...out.constraints];
  for (const want of expected.constraints) {
    const i = left.findIndex((c) => c.tag === want.tag);
    const have = i >= 0 ? left.splice(i, 1)[0]! : undefined;
    const wanted = [...want.allergens].sort().join();
    if (!have || [...have.allergens].sort().join() !== wanted) {
      constraintsWrong++;
      if (want.allergens.some((a) => !have?.allergens.includes(a))) critical++; // a lost allergen is never minor
    }
  }
  constraintsWrong += left.length;

  return {
    expectedMedications: expected.medications.length, matched, names: matched, doses, frequencies, durations, missed, invented,
    constraintsExpected: expected.constraints.length, constraintsWrong, critical,
    needsManualFix: fixes + missed + invented + constraintsWrong > 0,
  };
}

export interface Aggregate {
  cases: number;
  nameAccuracy: number;
  doseAccuracy: number;
  frequencyAccuracy: number;
  durationAccuracy: number;
  missed: number;
  invented: number;
  constraintErrors: number;
  critical: number;
  manualFixRate: number;
}

const ratio = (n: number, d: number) => (d === 0 ? 1 : n / d);

export function aggregate(all: readonly CaseMetrics[]): Aggregate {
  const sum = (f: (m: CaseMetrics) => number) => all.reduce((n, m) => n + f(m), 0);
  return {
    cases: all.length,
    nameAccuracy: ratio(sum((m) => m.names), sum((m) => m.expectedMedications)),
    doseAccuracy: ratio(sum((m) => m.doses), sum((m) => m.matched)),
    frequencyAccuracy: ratio(sum((m) => m.frequencies), sum((m) => m.matched)),
    durationAccuracy: ratio(sum((m) => m.durations), sum((m) => m.matched)),
    missed: sum((m) => m.missed),
    invented: sum((m) => m.invented),
    constraintErrors: sum((m) => m.constraintsWrong),
    critical: sum((m) => m.critical),
    manualFixRate: ratio(all.filter((m) => m.needsManualFix).length, all.length),
  };
}
