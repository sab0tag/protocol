/** Doctor portal: turns the form's text into a care plan the server accepts, and builds the patient's link. */
import { parseClinicPlan, type ClinicPlanV1 } from './planImport';

export interface ClinicIdentity { organizationId: string; organizationName: string; displayName: string }
export interface PlanForm { title: string; medications: string; restrictions: string; tests: string; followUp: string }

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/** One medication per line: «назва | доза | частота | тривалість | інструкції» — the first three are required. */
export function composePlan(form: PlanForm, who: ClinicIdentity, newId: () => string = () => crypto.randomUUID(), now: () => Date = () => new Date()):
  { plan: ClinicPlanV1 } | { error: 'title' | 'medication' | 'empty' | 'invalid' } {
  const title = form.title.trim();
  if (!title) return { error: 'title' };
  const medications: ClinicPlanV1['medications'] = [];
  for (const l of lines(form.medications)) {
    const [name = '', dose = '', frequency = '', duration = '', ...rest] = l.split('|').map((x) => x.trim());
    if (!name || !dose || !frequency) return { error: 'medication' };
    medications.push({ name, dose, frequency, duration, instructions: rest.join(' | ') });
  }
  const restrictions = lines(form.restrictions), tests = lines(form.tests), followUp = form.followUp.trim();
  if (!medications.length && !restrictions.length && !tests.length && !followUp) return { error: 'empty' };
  const plan = parseClinicPlan({
    schemaVersion: 1, planId: newId(), organizationId: who.organizationId, issuedAt: now().toISOString(),
    clinician: { displayName: who.displayName, organizationName: who.organizationName },
    title, medications, restrictions, tests, ...(followUp ? { followUp } : {}),
  });
  return plan ? { plan } : { error: 'invalid' };
}

/** The code travels in the URL fragment, so it is never sent to a web server or written to its logs. */
export const patientLink = (base: string, code: string) => `${base}#/plan/import?code=${encodeURIComponent(code)}`;
