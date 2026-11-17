import { SceneHeader } from '../components/SceneHeader';
import { Backup } from '../components/Backup';
import { ExampleNotice } from '../components/ExampleNotice';
import { usePlan } from '../data/queries';
import { t } from '../i18n/uk';

export function Data() {
  const plan = usePlan();
  return (
    <section className="space-y-4 pt-4">
      <SceneHeader title={t.data.title} />
      <ExampleNotice plan={plan} />
      <p className="text-sm text-muted">{t.data.hint}</p>
      <Backup alwaysOpen />
    </section>
  );
}
