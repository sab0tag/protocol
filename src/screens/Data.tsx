import { SceneHeader } from '../components/SceneHeader';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Backup } from '../components/Backup';
import { ExampleNotice } from '../components/ExampleNotice';
import { usePlan } from '../data/queries';
import { t } from '../i18n/uk';

export function Data() {
  const plan = usePlan();
  return (
    <section className="space-y-4 pt-4">
      <Link to="/more" className="inline-flex min-h-tap items-center gap-1 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden />{t.nav.more}
      </Link>
      <SceneHeader title={t.data.title} />
      <ExampleNotice plan={plan} />
      <p className="text-sm text-muted">{t.data.hint}</p>
      <Backup alwaysOpen />
    </section>
  );
}
