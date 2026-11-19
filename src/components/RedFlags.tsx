// D181: the red flags with a cast, a fracture or after an operation — static words, never a model. Shown in the rehab complex
// and in «Мені погано» while the plan has an injury. A draft until a doctor reads and signs it, and it says so.
import { Phone } from 'lucide-react';
import { RED_FLAGS, RED_FLAGS_SIGNED } from '../domain/rehabSafety';
import { t } from '../i18n/uk';

export function RedFlags() {
  const R = t.redFlags;
  return (
    <section aria-label={R.title} className="mt-3 rounded-xl border border-line p-3 text-sm" data-testid="red-flags">
      <p className="font-semibold">{R.title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">{RED_FLAGS.map((f) => <li key={f}>{f}</li>)}</ul>
      <a href="tel:103" className="mt-2 inline-flex min-h-tap items-center gap-2 rounded-full bg-warn px-4 font-semibold text-surface"><Phone size={16} aria-hidden />{R.call}</a>
      {!RED_FLAGS_SIGNED && <p className="mt-2 text-xs text-muted">{R.draft}</p>}
    </section>
  );
}
