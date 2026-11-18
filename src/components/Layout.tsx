import { Home, ClipboardList, LineChart, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { t } from '../i18n/uk';
import { Toaster } from './Toast';
import { ROUTES, TAB_ROUTES, tabForPath, type TabRouteId } from '../app/navigation';
import { useFeatures } from '../app/features';
import { AppHeader } from './AppHeader';
import { DemoStandStrip, ExampleStrip } from './ExampleNotice';

const TABS = {
  day: { label: t.nav.day, Icon: Home },
  plan: { label: t.nav.plan, Icon: ClipboardList },
  progress: { label: t.nav.progress, Icon: LineChart },
} satisfies Record<TabRouteId, { label: string; Icon: LucideIcon }>;

/** Bottom tab bar on phones, an icon rail from 768 px — same icons and routes (SPEC.md §5). Only the three sections
 *  show it; a screen opened over a section (a meal, a plan line, «Ще») has «Назад» in the header instead (ТЗ 17.11). */
export function Layout({ children }: { children: ReactNode }) {
  const { can } = useFeatures();
  const { pathname } = useLocation();
  const active = tabForPath(pathname);
  return (
    <div className="protocol-app-shell relative min-h-dvh min-w-0 md:flex" data-tabs={active ? 'on' : 'off'}>
      <a href="#protocol-content" onClick={(event) => { event.preventDefault(); document.getElementById('protocol-content')?.focus(); }}
        className="protocol-skip-link print:hidden">{t.shell.skip}</a>
      {active && <nav aria-label="Розділи"
        className="protocol-bottom-nav fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-safe print:hidden md:static md:inset-auto md:w-20 md:shrink-0 md:border-r md:border-t-0 md:pt-safe lg:w-52">
        <ul className="flex gap-1 px-1 py-1.5 md:sticky md:top-0 md:flex-col md:gap-3 md:px-2 md:py-4 lg:px-3">
          {TAB_ROUTES.filter((id) => can(ROUTES[id].feature)).map((id) => { const { label, Icon } = TABS[id];
            const isActive = id === active;
            return (
            <li key={id} className="min-w-0 flex-1 md:flex-none">
              <Link to={ROUTES[id].path} aria-label={label} aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-tap flex-col items-center justify-center gap-1 rounded-2xl py-2 text-xs lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm ${isActive ? 'font-semibold text-accent' : 'text-muted'}`}>
                <Icon size={21} aria-hidden />
                <span>{label}</span>
              </Link>
            </li>
          ); })}
        </ul>
      </nav>}
      <Toaster />
      <div className={`protocol-app-content mx-auto min-w-0 w-full max-w-2xl px-4 pt-safe md:pb-10 ${active ? 'pb-28' : 'pb-10'} lg:max-w-4xl lg:px-8 print:max-w-none print:pb-0`}>
        <DemoStandStrip />
        <ExampleStrip />
        <AppHeader />
        <main id="protocol-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
