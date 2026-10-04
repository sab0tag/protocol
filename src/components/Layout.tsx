import { CalendarDays, ClipboardList, LineChart, MoreHorizontal, UtensilsCrossed } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { t } from '../i18n/uk';

const TABS = [
  { to: '/', label: t.nav.day, Icon: CalendarDays, end: true },
  { to: '/meal/new', label: t.nav.food, Icon: UtensilsCrossed, end: false },
  { to: '/plan', label: t.nav.plan, Icon: ClipboardList, end: false },
  { to: '/progress', label: t.nav.progress, Icon: LineChart, end: false },
  { to: '/more', label: t.nav.more, Icon: MoreHorizontal, end: false },
];

/** Bottom tab bar on phones, an icon rail from 768 px — same icons and routes (SPEC.md §5). */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:flex">
      <nav aria-label="Розділи"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-safe print:hidden md:static md:inset-auto md:w-20 md:shrink-0 md:border-r md:border-t-0 md:pt-safe">
        <ul className="flex md:sticky md:top-0 md:flex-col md:gap-1 md:py-4">
          {TABS.map(({ to, label, Icon, end }) => (
            <li key={to} className="flex-1 md:flex-none">
              <NavLink to={to} end={end}
                className={({ isActive }) =>
                  `flex min-h-tap flex-col items-center justify-center gap-0.5 py-1.5 text-xs ${isActive ? 'text-accent font-medium' : 'text-muted'}`}>
                <Icon size={22} aria-hidden />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="mx-auto w-full max-w-2xl px-4 pb-28 pt-safe md:pb-10 print:max-w-none print:pb-0">{children}</main>
    </div>
  );
}
