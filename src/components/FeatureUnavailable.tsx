import { Link } from 'react-router-dom';
import { useFeatures } from '../app/features';
import { FEATURES, type FeatureId } from '../domain/features';
import { t } from '../i18n/uk';

/** Direct URLs remain explainable and never enable a module as a side effect. */
export function FeatureUnavailable({ feature }: { feature: FeatureId }) {
  const { can } = useFeatures();
  const module = FEATURES[feature].module;
  return <section className="space-y-3 pt-6">
    <h1 className="text-2xl font-semibold">{t.modules.unavailable}</h1>
    <p>{feature === 'wellbeing.weight' ? t.modules.disabled(t.progress.weight) : module ? t.modules.disabled(t.modules.names[module]) : t.modules.disabledAction}</p>
    <p className="text-sm text-muted">{t.modules.kept}</p>
    <Link to="/modules" className="inline-flex min-h-tap items-center rounded-xl bg-accent px-4 font-medium text-surface">{t.modules.title}</Link>
    {feature === 'progress' && can('wellbeing.weight') && <Link to="/weight" className="ml-3 inline-flex min-h-tap items-center text-accent underline">{t.progress.weight}</Link>}
    <p><Link to="/" className="inline-flex min-h-tap items-center text-accent underline">{t.nav.day}</Link></p>
  </section>;
}
