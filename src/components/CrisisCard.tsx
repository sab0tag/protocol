// D130: words of despair — «не хочу жити», «покінчити з собою» — get this card, never a model's answer and never «запишіть у
// звіт». Lifeline Ukraine 7333 (цілодобово, безкоштовно — програма «Ти як?», kmu.gov.ua) and 112. Hard code.
import { Phone } from 'lucide-react';
import { t } from '../i18n/uk';

export function CrisisCard({ className = 'mt-3' }: { className?: string }) {
  return (
    <div role="alert" aria-label={t.crisis.title} data-card="crisis" className={`${className} space-y-2 rounded-xl border border-warn bg-warn-bg p-3 text-warn`}>
      <p className="font-medium">{t.crisis.text}</p>
      <div className="flex flex-wrap gap-2">
        <a href="tel:7333" className="flex min-h-tap flex-1 items-center justify-center gap-2 rounded-xl bg-warn px-4 font-semibold text-surface"><Phone size={18} aria-hidden />{t.crisis.call7333}</a>
        <a href="tel:112" className="flex min-h-tap flex-1 items-center justify-center gap-2 rounded-xl border border-warn px-4 font-semibold"><Phone size={18} aria-hidden />{t.crisis.call112}</a>
      </div>
    </div>
  );
}
