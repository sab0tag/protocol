import { BadgeCheck, ChevronLeft, MoreHorizontal } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { isClinicPath, parentPath, tabForPath } from '../app/navigation';
import { usePlan } from '../data/queries';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';
import { useSync } from '../sync/runner';

/** ТЗ 17.11, step 2: one «Ще» on the right, no menu drawer. A section shows the name; a screen opened over it shows
 *  «Назад». Sync appears here only when it is broken, in words — otherwise its state is in «Ще → Налаштування». */
export function AppHeader() {
  const { pathname, key } = useLocation();
  const navigate = useNavigate();
  const plan = usePlan();
  const onboarded = useUi((s) => s.onboarded);
  const status = useSync((state) => state.status);
  // the first «Знайомство» is the only way in: nothing to go back to, and «Ще» would only lead back here
  const firstRun = pathname === '/welcome' && !!plan && !plan.onboardedAt && !onboarded;
  const back = () => (key !== 'default' ? navigate(-1) : navigate(parentPath(pathname)));
  const clinic = isClinicPath(pathname); // D168: staff screens are not the patient's — no «Ще», their own name
  return <header className="protocol-app-header print:hidden">
    {tabForPath(pathname) || firstRun
      ? <Link to="/" aria-label={t.shell.home} className="protocol-brand">
        <BadgeCheck size={26} className="text-accent" aria-hidden /><span>{t.shell.brand}</span>
      </Link>
      : <button type="button" onClick={back} className="protocol-header-back">
        <ChevronLeft size={22} aria-hidden /><span>{t.shell.back}</span>
      </button>}
    {clinic && <span className="min-w-0 flex-1 truncate text-center font-semibold">{t.shell.clinic}</span>}
    {!firstRun && !clinic && <div className="flex min-w-0 items-center justify-end gap-1">
      {status === 'error' && <Link to="/sync" className="protocol-header-status">{t.day.syncStatus.error}</Link>}
      <Link to="/more" aria-current={pathname === '/more' ? 'page' : undefined} className="protocol-header-more">
        <MoreHorizontal size={22} aria-hidden /><span>{t.nav.more}</span>
      </Link>
    </div>}
  </header>;
}
