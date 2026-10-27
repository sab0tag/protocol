import { LabsScan } from '../components/LabsScan';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { useLabs } from '../data/queries';
import { db } from '../data/db';
import { labRows } from '../domain/progress';
import { todayISO } from '../domain/dates';
import { t } from '../i18n/uk';
import { format, parseISO } from 'date-fns';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

const L = t.progress;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const dm = (date: string) => format(parseISO(date), 'dd.MM');
const num = (value: number) => value.toLocaleString('uk-UA', { maximumFractionDigits: 1 });

export function Labs() {
  const labs = useLabs();
  const [open, setOpen] = useState(false);
  const [lab, setLab] = useState({ date: todayISO(), name: '', value: '', unit: '', target: '' });
  if (!labs) return <Loading />;
  const rows = labRows(labs);
  const save = async () => {
    const value = Number(lab.value.replace(',', '.'));
    if (!lab.name.trim() || Number.isNaN(value)) return;
    await saved(db.labs.put({ date: lab.date, name: lab.name.trim(), value, unit: lab.unit.trim(), ...(lab.target.trim() ? { target: lab.target.trim() } : {}) }), t.toast.lab(lab.name.trim()));
    setLab({ ...lab, value: '', target: '' });
    setOpen(false);
  };

  return (
    <section className="space-y-4 pt-4">
      <Link to="/progress" className="inline-flex min-h-tap items-center text-sm text-muted">{t.progress.title}</Link>
      <header className="protocol-scene-header flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{L.labs}</h1>
        <button type="button" onClick={() => setOpen(!open)} className="flex min-h-tap items-center gap-1 px-2 text-accent"><Plus size={18} />{L.addLab}</button>
      </header>
      <LabsScan known={rows} />
      {open && (
        <form className="grid grid-cols-2 gap-2 protocol-card rounded-2xl border border-line bg-surface p-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="col-span-2 block"><span className="text-sm text-muted">{L.labName}</span>
            <input required value={lab.name} onChange={(e) => setLab({ ...lab, name: e.target.value })} list="lab-names" className={field} /></label>
          <datalist id="lab-names">{rows.map((row) => <option key={row.name} value={row.name} />)}</datalist>
          <label className="block"><span className="text-sm text-muted">{L.value}</span>
            <input required inputMode="decimal" value={lab.value} onChange={(e) => setLab({ ...lab, value: e.target.value })} className={field} /></label>
          <label className="block"><span className="text-sm text-muted">{L.unit}</span>
            <input value={lab.unit} onChange={(e) => setLab({ ...lab, unit: e.target.value })} className={field} /></label>
          <label className="block"><span className="text-sm text-muted">{L.date}</span>
            <input type="date" value={lab.date} onChange={(e) => setLab({ ...lab, date: e.target.value })} className={field} /></label>
          <label className="block"><span className="text-sm text-muted">{L.target}</span>
            <input value={lab.target} onChange={(e) => setLab({ ...lab, target: e.target.value })} placeholder="< 5,6" className={field} /></label>
          <button type="submit" className="col-span-2 min-h-tap rounded-xl bg-accent font-medium text-surface">{t.plan.save}</button>
        </form>
      )}
      {rows.length ? (
        <div className="overflow-x-auto protocol-card rounded-2xl border border-line bg-surface p-3">
          <table className="w-full text-sm tabular">
            <thead><tr className="text-left text-muted"><th className="py-1 font-normal">{L.labName}</th><th className="text-right font-normal">{L.was}</th>
              <th className="text-right font-normal">{L.nowCol}</th><th className="text-right font-normal">{L.target}</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.name} className="border-t border-line">
                <td className="py-2">{row.name}{row.unit && <span className="text-muted">, {row.unit}</span>}</td>
                <td className="text-right">{num(row.was.value)}<span className="block text-xs text-muted">{dm(row.was.date)}</span></td>
                <td className="text-right font-medium">{row.now.date === row.was.date ? '—' : num(row.now.value)}
                  {row.now.date !== row.was.date && <span className="block text-xs font-normal text-muted">{dm(row.now.date)}</span>}</td>
                <td className="text-right">{row.target ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="protocol-card rounded-2xl border border-line bg-surface p-3 text-muted">{L.noLabs}</p>}
    </section>
  );
}
