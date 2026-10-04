import { Activity, Dumbbell, FileText, ListChecks } from 'lucide-react';
import { t } from '../i18n/uk';

const NEXT = [
  { Icon: ListChecks, title: 'Мій день', when: 'M3' },
  { Icon: Activity, title: 'Самопочуття', when: 'M3' },
  { Icon: Dumbbell, title: 'Тренування', when: 'M3' },
  { Icon: FileText, title: 'Звіт для лікаря, експорт і імпорт', when: 'M4' },
];

export function More() {
  return (
    <section className="pt-6">
      <h1 className="mb-3 text-2xl font-semibold">{t.nav.more}</h1>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {NEXT.map(({ Icon, title, when }) => (
          <li key={title} className="flex min-h-tap items-center gap-3 px-3 py-2 text-muted">
            <Icon size={20} aria-hidden /><span className="flex-1">{title}</span><span className="text-sm">{t.soon.title} · {when}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted">{t.plan.disclaimer}</p>
    </section>
  );
}
