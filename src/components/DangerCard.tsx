// D56 / D91: the danger card — the same everywhere it appears: «Мені погано» and any free text the concierge would read.
// Hard code, never a model's words.
import { Phone, TriangleAlert } from 'lucide-react';
import { t } from '../i18n/uk';

export function DangerCard({ className = 'mt-3' }: { className?: string }) {
  return (
    <div role="alert" className={`${className} space-y-2 rounded-xl border border-warn bg-warn-bg p-3 text-warn`}>
      <p className="flex items-start gap-2 font-medium"><TriangleAlert size={20} className="mt-0.5 shrink-0" aria-hidden />{t.symptom.dangerAlert}</p>
      <a href="tel:103" className="flex min-h-tap items-center justify-center gap-2 rounded-xl bg-warn px-4 font-semibold text-surface"><Phone size={18} aria-hidden />{t.symptom.call}</a>
    </div>
  );
}
