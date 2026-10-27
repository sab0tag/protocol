import { CalendarDays, ClipboardList, LineChart, MoreHorizontal, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { t } from '../i18n/uk';
import { Toaster } from './Toast';
import { ROUTES, TAB_ROUTES, type TabRouteId } from '../app/navigation';

const TABS = {
  day: { label: t.nav.day, Icon: CalendarDays, tone: 'text-emerald-500' },
  mealNew: { label: t.nav.food, Icon: UtensilsCrossed, tone: 'text-rose-500' },
  plan: { label: t.nav.plan, Icon: ClipboardList, tone: 'text-amber-500' },
  progress: { label: t.nav.progress, Icon: LineChart, tone: 'text-sky-500' },
  more: { label: t.nav.more, Icon: MoreHorizontal, tone: 'text-violet-500' },
} satisfies Record<TabRouteId, { label: string; Icon: LucideIcon; tone: string }>;

/** Bottom tab bar on phones, an icon rail from 768 px — same icons and routes (SPEC.md §5). */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:flex">
      <nav aria-label="Розділи"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-safe print:hidden md:static md:inset-auto md:w-20 md:shrink-0 md:border-r md:border-t-0 md:pt-safe">
        <ul className="flex gap-1 px-1 py-1.5 md:sticky md:top-0 md:flex-col md:gap-3 md:px-2 md:py-4">
          {TAB_ROUTES.map((id) => { const { label, Icon, tone } = TABS[id]; return (
            <li key={id} className="flex-1 md:flex-none">
              <NavLink to={ROUTES[id].path} end={id === 'day'} aria-label={label}
                className={({ isActive }) =>
                  `flex min-h-tap flex-col items-center justify-center gap-1 rounded-2xl py-2 text-xs ${isActive ? 'bg-accent/10 font-semibold' : 'text-muted'}`}>
                <Icon size={21} className={tone} aria-hidden />
                <span>{label}</span>
              </NavLink>
            </li>
          ); })}
        </ul>
      </nav>
      <Toaster />
      <main className="mx-auto w-full max-w-2xl px-4 pb-28 pt-safe md:pb-10 print:max-w-none print:pb-0">
        {children}</main>
    </div>
  );
}
