import { Navigate, useParams } from 'react-router-dom';
import { SETTINGS_ROUTES } from '../app/navigation';
import { LinkList, useMoreLinks } from './More';
import { t } from '../i18n/uk';
import { useSync } from '../sync/runner';
import { ProfilePhotoSettings } from '../components/ProfilePhotoSettings';
import { ThemeSettings } from '../components/ThemeSettings';
import { VoiceSettings } from '../components/VoiceSettings';

/** «Ще → Налаштування». The old categories of «Ще» (/more/food, /more/health, /more/app) lead to the one list. */
export function MoreCategory() {
  const { category } = useParams();
  const status = useSync((state) => state.status);
  const links = useMoreLinks(SETTINGS_ROUTES)
    // ТЗ 17.11: the sync state left the header; it is said here, in words
    .map((link) => (link.to === '/sync' ? { ...link, hint: t.day.syncStatus[status] } : link));
  if (category !== 'settings') return <Navigate to="/more" replace />;
  return (
    <section className="space-y-4 pt-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t.more.settings}</h1>
      <LinkList links={links} />
      <ThemeSettings />
      <VoiceSettings />
      <ProfilePhotoSettings />
    </section>
  );
}
