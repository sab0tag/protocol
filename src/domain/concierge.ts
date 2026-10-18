// D91: the concierge's code half. Scenario 2 «Чому позначено?» needs no model: the answer is the plan's own item — its
// title, the doctor's reason and source — and what the check found in this line. Nothing is interpreted, no number is
// made up, nothing about health is said beyond what the plan already says.
import type { RuleHit } from './rules';
import type { Constraint, Plan } from './types';
import { t } from '../i18n/uk';

export interface Why { text: string; constraint?: Constraint }

/** The plan item a flag comes from, and two short sentences: what the plan says, what was found here. */
export function whyFlagged(hit: RuleHit, plan: Pick<Plan, 'constraints'>): Why {
  const c = plan.constraints.find((x) => x.active && x.tag === hit.reason && (hit.reason !== 'diet' || hit.message.startsWith(`${x.diet}:`)));
  const found = t.why.found(hit.itemName, hit.message, hit.suggestion);
  if (!c) return { text: found };
  return { text: `${t.why.plan(c.title, c.reason, c.source)} ${found}`, constraint: c };
}

/** A short, stable fingerprint of what the plan says now — the log's «versions.plan», to see advice on an old plan. */
export function planVersion(plan: Pick<Plan, 'constraints' | 'prescriptions' | 'targets' | 'modes'> | undefined): string {
  const s = JSON.stringify(plan ? [plan.constraints, plan.prescriptions, plan.targets, plan.modes] : []);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The running build as the log knows it — the bundle's name («mTi15J5D»), the same the analyst checks against a commit. */
export function appVersion(): string {
  try {
    const src = [...document.querySelectorAll('script[src]')].map((s) => (s as HTMLScriptElement).src).find((x) => /index-[\w-]+\.js/.test(x));
    return /index-([\w-]+)\.js/.exec(src ?? '')?.[1] ?? 'dev';
  } catch { return 'dev'; }
}
