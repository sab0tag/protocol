import { ArrowDown, ArrowUp } from 'lucide-react';
import { saveMarkOrder, useMarkOrder } from '../data/markOrder';
import { SceneHeader } from '../components/SceneHeader';
// D66: «Швидкі дії» — the links of `#/do/…`, ready to copy into Shortcuts / Back Tap, and how.
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { t } from '../i18n/uk';
import { useFeatures } from '../app/features';
import { QUICK_ACTION_FEATURES } from '../app/navigation';

const L = t.quick;
// D164: the four marks of «Сьогодні» first — the same links the Android icon offers on a long press
const ACTIONS = [['meds', L.meds], ['water', L.water], ['mood', L.mood], ['food', L.food], ['water?ml=500', L.water500], ['voice', t.voice.open], ['symptom', L.symptom]] as const;

export function QuickLinks() {
  const { can } = useFeatures();
  const base = `${location.origin}${location.pathname}#/do/`;
  const [copied, setCopied] = useState('');
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); setCopied(url); } catch { setCopied(''); } };
  return (
    <section className="space-y-4 pt-4">
      <SceneHeader title={L.title} />
      <MarkOrder />
      <p className="text-sm text-muted">{L.hint}</p>
      <ul className="divide-y divide-line protocol-card rounded-2xl border border-line bg-surface">
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
      <div className="space-y-2 protocol-card rounded-2xl border border-line bg-surface p-3 text-sm">
        <p className="font-semibold">{L.howTitle}</p>
        <ol className="list-decimal space-y-1 pl-5">{L.how.map((x) => <li key={x}>{x}</li>)}</ol>
        <p className="text-warn">{L.safari}</p>
      </div>
    </section>
  );
}

/** D164: the order of the quick marks on «Сьогодні» — up and down, saved on this device. */
function MarkOrder() {
  const order = useMarkOrder();
  const move = (i: number, by: -1 | 1) => { const next = [...order]; [next[i], next[i + by]] = [next[i + by]!, next[i]!]; saveMarkOrder(next); };
  const names = { meds: t.marks.meds, water: t.marks.water, mood: t.marks.mood, workout: t.marks.workout };
  return <section aria-labelledby="mark-order" className="protocol-card space-y-2 p-4">
    <h2 id="mark-order" className="font-semibold">{t.marks.order}</h2>
    <p className="text-sm text-muted">{t.marks.orderHint}</p>
    <ol className="divide-y divide-line">
      {order.map((key, i) => <li key={key} className="flex min-h-tap items-center gap-2">
        <span className="tabular w-5 text-muted">{i + 1}</span><span className="flex-1 font-medium">{names[key]}</span>
        <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t.marks.up(names[key])} className="flex min-h-tap min-w-tap items-center justify-center rounded-full disabled:opacity-30"><ArrowUp size={18} aria-hidden /></button>
        <button type="button" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={t.marks.down(names[key])} className="flex min-h-tap min-w-tap items-center justify-center rounded-full disabled:opacity-30"><ArrowDown size={18} aria-hidden /></button>
      </li>)}
    </ol>
  </section>;
}
