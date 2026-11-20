// D197: «Норми застосунку» for doctors — the reference values the app uses where a doctor gave none, by specialty, each with its
// source and version and its review state; print (PDF) or copy the text to send. Made from norms.ts (normsSheet.ts) alone.
import { useState } from 'react';
import { SPECIALTIES, type Specialty } from '../domain/norms';
import { normsSheet, sheetNorms, SHEET_INTRO } from '../domain/normsSheet';

const ALL = Object.keys(SPECIALTIES) as Specialty[];

export function ClinicNorms() {
  const [s, setS] = useState<Specialty>('endocrinologist');
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(normsSheet(s)).then(() => setCopied(true), () => setCopied(false));
  return (
    <section className="space-y-4 pt-4" data-testid="clinic-norms">
      <h1 className="text-2xl font-semibold">Норми застосунку на перевірку</h1>
      <p className="text-sm">{SHEET_INTRO}</p>
      <fieldset className="print:hidden"><legend className="text-sm font-medium">Спеціальність</legend>
        <div className="mt-1 flex flex-wrap gap-2">{ALL.map((x) => (
          <button key={x} type="button" aria-pressed={s === x} onClick={() => { setS(x); setCopied(false); }}
            className={`min-h-tap rounded-full border-2 px-3 text-sm font-semibold ${s === x ? 'border-accent text-accent' : 'border-line'}`}>{SPECIALTIES[x]}</button>))}</div>
      </fieldset>
      <h2 className="text-lg font-semibold">{SPECIALTIES[s]}</h2>
      <ol className="space-y-3">{sheetNorms(s).map((n) => (
        <li key={n.id} className="protocol-card space-y-1 p-3 text-sm" data-testid={`norm-${n.id}`}>
          <h3 className="font-semibold">{n.title}</h3>
          <p>{n.says}</p>
          <p className="text-muted">Де в застосунку: {n.usedIn}</p>
          <p className="text-muted">Джерело: {n.source}</p>
          {n.note && <p className="text-muted">Примітка: {n.note}</p>}
          <p className={n.draft ? 'font-semibold' : ''}>{n.status}</p>
          <p className="hidden print:block">Рішення лікаря: ☐ Погоджую · ☐ Змінити на: ____________ · ПІБ, дата, версія джерела: ____________</p>
        </li>))}</ol>
      <div className="flex flex-wrap gap-2 print:hidden">
        <button type="button" onClick={() => window.print()} className="min-h-tap rounded-xl bg-accent px-4 font-semibold text-on-accent">Друк або PDF</button>
        <button type="button" onClick={copy} className="min-h-tap rounded-xl border-2 border-line px-4 font-semibold">Скопіювати текст</button>
      </div>
      {copied && <p role="status" className="text-sm">Текст скопійовано — вставте в лист чи повідомлення.</p>}
    </section>
  );
}
