import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { MORE_GROUPS } from './More';
import { t } from '../i18n/uk';
import { SceneHeader } from '../components/SceneHeader';
import { ProfilePhotoSettings } from '../components/ProfilePhotoSettings';

export function MoreCategory() {
  const { category } = useParams();
  const group = MORE_GROUPS.find((item) => item.id === category);
  if (!group) return <Navigate to="/more" replace />;

  return (
    <section className="space-y-4 pt-4">
      <Link to="/more" className="inline-flex min-h-tap items-center gap-1 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />{t.nav.more}
      </Link>
      <SceneHeader title={group.title} description={group.hint} />
      {category === 'settings' && <ProfilePhotoSettings />}
      <ul className="divide-y divide-line overflow-hidden protocol-card rounded-2xl border border-line bg-surface">
        {group.links.map(({ to, Icon, title }) => (
          <li key={to}>
            <Link to={to} className="flex min-h-tap items-center gap-3 px-4 py-4">
              <Icon size={20} className="text-accent" aria-hidden />
              <span className="flex-1 font-medium">{title}</span>
              <ChevronRight size={18} className="text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
