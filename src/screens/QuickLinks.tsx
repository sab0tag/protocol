// D66: «Швидкі дії» — the links of `#/do/…`, ready to copy into Shortcuts / Back Tap, and how.
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { t } from '../i18n/uk';
import { useFeatures } from '../app/features';
import { QUICK_ACTION_FEATURES } from '../app/navigation';

const L = t.quick;
const ACTIONS = [['voice', t.voice.open], ['water', L.water], ['water?ml=500', L.water500], ['med', L.med], ['symptom', L.symptom], ['meal', L.meal]] as const;

export function QuickLinks() {
  const { can } = useFeatures();
  const base = `${location.origin}${location.pathname}#/do/`;
  const [copied, setCopied] = useState('');
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); setCopied(url); } catch { setCopied(''); } };
  return (
    <section className="space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">{L.title}</h1>
      <p className="text-sm text-muted">{L.hint}</p>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {ACTIONS.filter(([a]) => can(QUICK_ACTION_FEATURES[a.split('?')[0] as keyof typeof QUICK_ACTION_FEATURES])).map(([a, label]) => {
          const url = base + a;
          return (
            <li key={a} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1"><span className="block font-medium">{label}</span><span className="block truncate text-xs text-muted">{url}</span></span>
              <button type="button" onClick={() => void copy(url)} aria-label={`${L.copy}: ${label}`}
                className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line text-accent">
                {copied === url ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}</button>
            </li>
          );
        })}
      </ul>
      <div className="space-y-2 rounded-2xl border border-line bg-surface p-3 text-sm">
        <p className="font-semibold">{L.howTitle}</p>
        <ol className="list-decimal space-y-1 pl-5">{L.how.map((x) => <li key={x}>{x}</li>)}</ol>
        <p className="text-warn">{L.safari}</p>
      </div>
    </section>
  );
}
