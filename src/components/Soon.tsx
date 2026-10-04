import { t } from '../i18n/uk';

export function Soon({ title, note }: { title: string; note?: string }) {
  return (
    <section className="pt-6">
      <h1 className="mb-2 text-2xl font-semibold">{title}</h1>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="font-medium">{t.soon.title}</p>
        <p className="text-muted">{t.soon.text}</p>
        {note && <p className="mt-3 text-sm text-muted">{note}</p>}
      </div>
    </section>
  );
}
