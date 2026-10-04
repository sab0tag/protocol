import { Activity, ChevronRight, Dumbbell, FileText, ListChecks, LineChart, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { t } from '../i18n/uk';

const LINKS = [
  { to: '/my-day', Icon: ListChecks, title: t.myday.title },
  { to: '/wellbeing', Icon: Activity, title: t.well.title },
  { to: '/workout', Icon: Dumbbell, title: t.workout.title },
  { to: '/welcome', Icon: UserRound, title: t.welcome.again },
];
const NEXT = [
  { Icon: LineChart, title: 'Прогрес: вага й аналізи', when: 'M4' },
  { Icon: FileText, title: 'Звіт для лікаря, експорт і імпорт', when: 'M4' },
];

export function More() {
  return (
    <section className="pt-6">
      <h1 className="mb-3 text-2xl font-semibold">{t.nav.more}</h1>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {LINKS.map(({ to, Icon, title }) => (
          <li key={to}><Link to={to} className="flex min-h-tap items-center gap-3 px-3 py-2">
            <Icon size={20} className="text-accent" aria-hidden /><span className="flex-1 font-medium">{title}</span>
            <ChevronRight size={18} className="text-muted" aria-hidden /></Link></li>
        ))}
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
