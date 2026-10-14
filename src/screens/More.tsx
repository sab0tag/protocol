import { Activity, BellRing, ChevronRight, Dumbbell, FileText, ListChecks, RefreshCw, Salad, ShoppingCart, Sparkles, UserRound, MessageSquareWarning, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Backup } from '../components/Backup';
import { t } from '../i18n/uk';

const LINKS = [
  { to: '/menu', Icon: Sparkles, title: t.menu.title },
  { to: '/shopping', Icon: ShoppingCart, title: t.shop.title },
  { to: '/reminders', Icon: BellRing, title: t.remind.title },
  { to: '/sync', Icon: RefreshCw, title: t.sync.title },
  { to: '/report', Icon: FileText, title: t.report.title },
  { to: '/dishes', Icon: Salad, title: t.dishes.title },
  { to: '/my-day', Icon: ListChecks, title: t.myday.title },
  { to: '/wellbeing', Icon: Activity, title: t.well.title },
  { to: '/workout', Icon: Dumbbell, title: t.workout.title },
  { to: '/exercises', Icon: Dumbbell, title: t.exercise.library },
  { to: '/quick', Icon: Zap, title: t.quick.title },
  { to: '/frictions', Icon: MessageSquareWarning, title: t.friction.title },
  { to: '/welcome', Icon: UserRound, title: t.welcome.again },
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
      </ul>
      <div className="mt-4"><Backup /></div>
      <p className="mt-4 text-sm text-muted">{t.plan.disclaimer}</p>
    </section>
  );
}
