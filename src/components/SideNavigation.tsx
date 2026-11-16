import { ChevronRight, Hospital } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useFeatures } from '../app/features';
import { ROUTES } from '../app/navigation';
import { t } from '../i18n/uk';
import { useMoreGroups } from '../screens/More';
import { Sheet } from './Sheet';

/** The same feature-filtered directory as More, collapsed into four familiar groups. */
export function SideNavigation({ onClose }: { onClose: () => void }) {
  const groups = useMoreGroups();
  const { can } = useFeatures();
  const { pathname } = useLocation();
  return <Sheet id="protocol-navigation" title={t.shell.menu} onClose={onClose} placement="left">
    <nav aria-label={t.shell.modules} className="space-y-2">
      {groups.map(({ id, title, Icon, links }) => <details key={id} className="rounded-2xl border border-line" open={links.some(link => link.to === pathname) || undefined}>
        <summary className="flex min-h-tap cursor-pointer items-center gap-3 rounded-2xl px-3 py-3 font-semibold">
          <Icon size={20} className="shrink-0 text-accent" aria-hidden /><span className="flex-1">{title}</span><ChevronRight size={18} aria-hidden />
        </summary>
        <ul className="space-y-1 border-t border-line p-2">
          {links.map(({ to, title: label, Icon: ItemIcon }) => <li key={to}>
            <Link to={to} onClick={onClose} aria-current={pathname === to ? 'page' : undefined}
              className="flex min-h-tap items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-bg aria-[current=page]:bg-bg aria-[current=page]:text-accent">
              <ItemIcon size={18} className="shrink-0 text-muted" aria-hidden /><span>{label}</span>
            </Link>
          </li>)}
        </ul>
      </details>)}
      {can(ROUTES.clinicPortal.feature) && <Link to={ROUTES.clinicPortal.path} onClick={onClose}
        className="flex min-h-tap items-center gap-3 rounded-xl px-3 py-2 font-medium hover:bg-bg">
        <Hospital size={20} className="text-accent" aria-hidden />{t.shell.clinic}
      </Link>}
    </nav>
  </Sheet>;
}
