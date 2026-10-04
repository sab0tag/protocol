import { format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';
import { Download, Share2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { exportAll, importAll, parseExport, type ExportFile } from '../data/backup';
import { db } from '../data/db';
import { usePlan } from '../data/queries';
import { todayISO } from '../domain/dates';
import { t } from '../i18n/uk';

const L = t.backup;
const dmy = (d: string) => format(parseISO(d), 'd MMMM yyyy', { locale: uk });

async function fileOf(): Promise<File> {
  const data = await exportAll();
  await db.plan.update('main', { lastExportAt: todayISO() });
  const name = `protocol-${format(new Date(), 'yyyy-MM-dd')}.json`;
  return new File([JSON.stringify({ ...data, plan: { ...data.plan, lastExportAt: todayISO() } }, null, 1)], name, { type: 'application/json' });
}

/** «Резервна копія» (SPEC.md §5.8, §8): save or send a JSON file; restore replaces everything after a confirmation. */
export function Backup() {
  const plan = usePlan();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ExportFile | null>(null);
  const [message, setMessage] = useState('');

  const download = async () => {
    const f = await fileOf();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = f.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const share = async () => {
    const f = await fileOf();
    try { await navigator.share({ files: [f], title: f.name }); } catch { /* closed */ }
  };
  const canShareFiles = typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] });
  const pick = async (file: File | undefined) => {
    setMessage('');
    if (!file) return;
    try { setPending(parseExport(await file.text())); } catch (e) { setMessage((e as Error).message); }
    if (input.current) input.current.value = '';
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-3">
      <h2 className="font-semibold">{L.title}</h2>
      <p className="mb-1 text-sm text-muted">{L.text}</p>
      <p className="mb-3 text-sm">{plan?.lastExportAt ? L.last(dmy(plan.lastExportAt)) : L.never}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void download()} className="flex min-h-tap items-center gap-2 rounded-xl bg-accent px-3 font-medium text-surface"><Download size={18} />{L.save}</button>
        {canShareFiles && <button type="button" onClick={() => void share()} className="flex min-h-tap items-center gap-2 rounded-xl border border-accent px-3 font-medium text-accent"><Share2 size={18} />{L.share}</button>}
        <button type="button" onClick={() => input.current?.click()} className="flex min-h-tap items-center gap-2 rounded-xl border border-line px-3"><Upload size={18} />{L.restore}</button>
        <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      {pending && (
        <div role="alertdialog" aria-label={L.restore} className="mt-3 rounded-xl border border-warn/40 bg-warn-bg p-3">
          <p className="mb-2 text-warn">{L.confirm(dmy(pending.exportedAt.slice(0, 10)))}</p>
          <div className="flex gap-2">
            <button type="button" onClick={async () => { await importAll(pending); setPending(null); setMessage(L.restored); }}
              className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{L.yes}</button>
            <button type="button" onClick={() => setPending(null)} className="min-h-tap rounded-xl border border-line bg-surface px-3">{L.no}</button>
          </div>
        </div>
      )}
      {message && <p role="status" className="mt-2 text-sm">{message}</p>}
    </section>
  );
}
