import { CalendarDays, ClipboardList, LineChart, MoreHorizontal, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { MORE_ROUTE_GROUPS } from '../app/navigation';
import { t } from '../i18n/uk';
import { Toaster } from './Toast';
import { ROUTES, TAB_ROUTES, type TabRouteId } from '../app/navigation';
import { sceneArtworkForPath } from '../domain/sceneArtwork';
import { useFeatures } from '../app/features';

const TABS = {
  day: { label: t.nav.day, Icon: CalendarDays },
  food: { label: t.nav.food, Icon: UtensilsCrossed },
  plan: { label: t.nav.plan, Icon: ClipboardList },
  progress: { label: t.nav.progress, Icon: LineChart },
  more: { label: t.nav.more, Icon: MoreHorizontal },
} satisfies Record<TabRouteId, { label: string; Icon: LucideIcon }>;

/** Bottom tab bar on phones, an icon rail from 768 px — same icons and routes (SPEC.md §5). */
export function Layout({ children }: { children: ReactNode }) {
  const { can } = useFeatures();
  const { pathname } = useLocation();
  const artwork = sceneArtworkForPath(pathname);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const items = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    drawerRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { document.removeEventListener('keydown', handleKey); (openerRef.current ?? previous)?.focus(); };
  }, [drawerOpen]);
  const foodActive = ['/food', '/meal', '/dishes'].some(p => pathname === p || pathname.startsWith(p + '/'));
  return (
    <div className="protocol-app-shell min-h-dvh min-w-0 md:flex">
      <nav aria-label="Розділи"
        className="protocol-bottom-nav fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-safe print:hidden md:static md:inset-auto md:w-20 md:shrink-0 md:border-r md:border-t-0 md:pt-safe lg:w-52">
        <ul className="flex gap-1 px-1 py-1.5 md:sticky md:top-0 md:flex-col md:gap-3 md:px-2 md:py-4 lg:px-3">
          {TAB_ROUTES.filter((id) => can(ROUTES[id].feature)).map((id) => { const { label, Icon } = TABS[id];
            const isActive = id === 'food' ? foodActive : pathname === ROUTES[id].path || (id !== 'day' && pathname.startsWith(ROUTES[id].path + '/'));
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
      </nav>
      <button ref={openerRef} type="button" aria-label="Відкрити меню" aria-expanded={drawerOpen} aria-controls="protocol-side-menu" onClick={() => setDrawerOpen(true)}
        className="fixed right-4 top-[calc(.5rem+env(safe-area-inset-top))] z-20 flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-surface text-ink shadow-sm print:hidden md:hidden">
        <Menu size={22} aria-hidden />
      </button>
      {drawerOpen && <div className="fixed inset-0 z-40 bg-black/50 print:hidden md:hidden" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
      <aside ref={drawerRef} id="protocol-side-menu" aria-label="Бічне меню" aria-modal={drawerOpen ? true : undefined} role={drawerOpen ? 'dialog' : undefined}
        className={`fixed inset-y-0 right-0 z-50 w-[min(21rem,calc(100vw-2rem))] overflow-y-auto border-l border-line bg-surface p-5 shadow-2xl print:hidden md:hidden ${drawerOpen ? 'block' : 'hidden'}`}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Розділи</h2>
          <button type="button" aria-label="Закрити меню" onClick={() => setDrawerOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-xl text-ink"><X size={22} aria-hidden /></button>
        </div>
        <nav aria-label="Бічна навігація">
          <ul className="space-y-1">
            {TAB_ROUTES.filter(id => can(ROUTES[id].feature)).map(id => {
              const { label, Icon } = TABS[id];
              return <li key={id}><Link to={ROUTES[id].path} aria-current={pathname === ROUTES[id].path ? 'page' : undefined}
                className="flex min-h-tap items-center gap-3 rounded-xl px-3 py-2 text-ink hover:bg-bg"><Icon size={20} aria-hidden />{label}</Link></li>;
            })}
          </ul>
          {MORE_ROUTE_GROUPS.map(group => {
            const routes = group.routes.filter(id => can(ROUTES[id].feature));
            if (!routes.length) return null;
            return <div key={group.id} className="mt-5 border-t border-line pt-3">
              <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted">{group.id === 'food' ? 'Їжа' : group.id === 'health' ? 'Здоров’я' : group.id === 'settings' ? 'Налаштування' : 'Застосунок'}</h3>
              <ul>{routes.map(id => <li key={id}><Link to={ROUTES[id].path} className="flex min-h-tap items-center rounded-xl px-3 py-2 text-sm text-ink hover:bg-bg">{id === 'assistant' ? 'Помічник' : id === 'reminders' ? 'Нагадування' : id === 'report' ? 'Звіт для лікаря' : id === 'workout' ? 'Тренування' : id === 'wellbeing' ? 'Самопочуття' : id === 'profiles' ? 'Профілі' : id === 'modules' ? 'Модулі' : id === 'data' ? 'Дані' : id === 'sync' ? 'Синхронізація' : id === 'about' ? 'Про застосунок' : id === 'dishes' ? 'Мої страви' : id === 'foods' ? 'Продукти' : id === 'menu' ? 'Меню' : id === 'shopping' ? 'Покупки' : id === 'weight' ? 'Вага' : id === 'week' ? 'Тиждень' : id === 'progressLabs' ? 'Аналізи' : id === 'onboarding' ? 'Початок' : id === 'quickLinks' ? 'Швидкі дії' : id}</Link></li>)}</ul>
            </div>;
          })}
        </nav>
      </aside>
      <Toaster />
      <main data-scene={artwork ?? 'day'} className="protocol-app-content mx-auto min-w-0 w-full max-w-2xl px-4 pb-28 pt-[calc(4rem+env(safe-area-inset-top))] md:pt-safe md:pb-10 lg:max-w-4xl lg:px-8 print:max-w-none print:pb-0">
        {children}</main>
    </div>
  );
}
