import { SceneHeader } from '../components/SceneHeader';
// D89: «Про застосунок» — what it is and where its reference data comes from, with the licences' required attribution.
import { useMedIndex } from '../data/medsIndex';
import { t } from '../i18n/uk';

const L = t.about;

export function About() {
  const index = useMedIndex();
  return (
    <section className="space-y-4 pt-6">
      <SceneHeader title={L.title} />
      <p>{t.plan.disclaimer}</p>
      <p className="text-sm text-muted">{L.privacy}</p>
      <section aria-label={L.sources} className="space-y-3 protocol-card rounded-2xl border border-line bg-surface p-3 text-sm">
        <h2 className="font-semibold">{L.sources}</h2>
        <p>{L.register} <a className="text-accent underline" href="https://data.gov.ua/dataset/fded13b8-4e2c-4c48-bf14-65d0e3106463" target="_blank" rel="noreferrer">data.gov.ua</a>
          {' · '}<a className="text-accent underline" href="https://creativecommons.org/licenses/by/4.0/deed.uk" target="_blank" rel="noreferrer">CC BY 4.0</a>
          {index && <span className="text-muted"> · {L.built(index.built, index.list.length)}</span>}</p>
        <p className="text-muted">{L.registerUse}</p>
        <p>{L.foods}</p>
      </section>
    </section>
  );
}
