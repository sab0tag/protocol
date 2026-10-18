import { Eye, Info, Activity, BellRing, ChevronRight, Dumbbell, FileText, RefreshCw, Salad, ShoppingCart, Sparkles, UserRound, CalendarRange, MessageSquareWarning, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Backup } from '../components/Backup';
import { enterDemo, inDemo } from '../data/db';
import { t } from '../i18n/uk';

// D78: four short groups instead of one list of 14; «Мій день» lives on «День», the exercise library inside «Тренування»
const GROUPS = [
  { title: t.more.food, links: [
    { to: '/menu', Icon: Sparkles, title: t.menu.quick },
    { to: '/shopping', Icon: ShoppingCart, title: t.shop.title },
    { to: '/dishes', Icon: Salad, title: t.dishes.title },
  ] },
  { title: t.more.health, links: [
    { to: '/wellbeing', Icon: Activity, title: t.well.title },
    { to: '/workout', Icon: Dumbbell, title: t.workout.title },
    { to: '/week', Icon: CalendarRange, title: t.week.title },
    { to: '/report', Icon: FileText, title: t.report.title },
  ] },
  { title: t.more.settings, links: [
    { to: '/reminders', Icon: BellRing, title: t.remind.title },
    { to: '/sync', Icon: RefreshCw, title: t.sync.title },
    { to: '/quick', Icon: Zap, title: t.quick.title },
  ] },
  { title: t.more.app, links: [
    { to: '/frictions', Icon: MessageSquareWarning, title: t.friction.title },
    { to: '/welcome', Icon: UserRound, title: t.welcome.again },
    { to: '/concierge-log', Icon: Sparkles, title: t.conciergeLog.link },
    { to: '/about', Icon: Info, title: t.about.link },
  ] },
];

export function More() {
  return (
    <section className="pt-6">
      <h1 className="mb-3 text-2xl font-semibold">{t.nav.more}</h1>
      {GROUPS.map((g) => (
        <section key={g.title} aria-label={g.title} className="mb-4">
          <h2 className="mb-1 px-1 text-sm font-medium text-muted">{g.title}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {g.links.map(({ to, Icon, title }) => (
              <li key={to}><Link to={to} className="flex min-h-tap items-center gap-3 px-3 py-2">
                <Icon size={20} className="text-accent" aria-hidden /><span className="flex-1 font-medium">{title}</span>
                <ChevronRight size={18} className="text-muted" aria-hidden /></Link></li>
            ))}
          </ul>
        </section>
      ))}
      {!inDemo() && <ExampleEntry />}
      <Backup />
      <p className="mt-4 text-sm text-muted">{t.plan.disclaimer}</p>
    </section>
  );
}

/** D98–D99: the example, one tap away — but asked first: from «Ще» the person has their own data, and must know it stays. */
function ExampleEntry() {
  const [asking, setAsking] = useState(false);
  return asking ? (
    <div role="alertdialog" aria-label={t.welcome.example} className="mb-4 space-y-2 rounded-2xl border border-accent/40 bg-surface p-3 text-sm">
      <p>{t.example.confirm}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={enterDemo} className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{t.example.confirmYes}</button>
        <button type="button" onClick={() => setAsking(false)} className="min-h-tap rounded-xl border border-line px-3">{t.example.confirmNo}</button>
      </div>
    </div>
  ) : (
    <button type="button" onClick={() => setAsking(true)} className="mb-4 flex min-h-tap w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2 text-left">
      <Eye size={20} className="text-accent" aria-hidden /><span className="flex-1"><span className="block font-medium">{t.welcome.example}</span>
        <span className="block text-sm text-muted">{t.example.safe}</span></span></button>
  );
}

