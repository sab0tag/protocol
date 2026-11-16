import { BadgeCheck, Bell, Cloud, CloudAlert, CloudCheck, CloudOff, Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useFeatures } from '../app/features';
import { t } from '../i18n/uk';
import { useSync, type SyncStatus } from '../sync/runner';

const CLOUD: Record<SyncStatus, { Icon: typeof Cloud; tone: string }> = {
  off: { Icon: CloudOff, tone: 'text-muted' }, idle: { Icon: CloudCheck, tone: 'text-accent' },
  syncing: { Icon: Cloud, tone: 'text-muted animate-pulse' }, offline: { Icon: CloudOff, tone: 'text-warn' },
  error: { Icon: CloudAlert, tone: 'text-warn' },
};

/** Shared navigation chrome. The bell opens real reminder settings; no invented unread badge. */
export function AppHeader({ menuOpen, onMenu }: { menuOpen: boolean; onMenu: () => void }) {
  const { can } = useFeatures();
  const status = useSync(state => state.status);
  const { Icon, tone } = CLOUD[status];
  return <header className="protocol-app-header print:hidden">
    <button type="button" onClick={onMenu} aria-label={t.shell.openMenu} aria-expanded={menuOpen}
      aria-controls={menuOpen ? 'protocol-navigation' : undefined} aria-haspopup="dialog" className="protocol-header-control">
      <Menu size={22} aria-hidden />
    </button>
    <Link to="/" aria-label={t.shell.home} className="protocol-brand">
      <BadgeCheck size={26} className="text-accent" aria-hidden /><span>{t.shell.brand}</span>
    </Link>
    <div className="flex items-center">
      <Link to="/sync" aria-label={t.day.syncStatus[status]} className={`protocol-header-control ${tone}`}><Icon size={20} aria-hidden /></Link>
      {can('reminders.settings') && <Link to="/reminders" aria-label={t.shell.reminders} className="protocol-header-control">
        <Bell size={21} aria-hidden />
      </Link>}
    </div>
  </header>;
}
