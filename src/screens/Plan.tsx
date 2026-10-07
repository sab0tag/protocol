import { format, parseISO } from 'date-fns';
import { PlanVersions } from '../components/PlanVersions';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { uk } from 'date-fns/locale';
import { Pencil, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Sheet } from '../components/Sheet';
import { db, type PlanRow } from '../data/db';
import { usePlan } from '../data/queries';
import { newId } from '../domain/dates';
import type { Constraint, ConstraintTag, Mode, Plan as PlanT, Prescription, Targets } from '../domain/types';
import { t } from '../i18n/uk';

const P = t.plan;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const TAGS = Object.keys(P.tags) as ConstraintTag[];
const KINDS = Object.keys(P.kinds) as Prescription['kind'][];

type Editing =
  | { what: 'prescription'; item?: Prescription }
  | { what: 'constraint'; item?: Constraint }
  | { what: 'mode'; item?: Mode }
  | { what: 'targets' }
  | { what: 'checkup' };

const save = (patch: Partial<PlanT>) => saved(db.plan.update('main', patch), t.toast.plan);
const dmy = (d: string) => format(parseISO(d), 'd MMMM', { locale: uk });

/** «План лікаря»: what the doctor said, as the user entered it. Nothing here is decided by the app. */
export function Plan() {
  const plan = usePlan();
  const [editing, setEditing] = useState<Editing | null>(null);
  if (!plan) return <Loading />;
  const tg = plan.targets;

  return (
    <section className="space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">{P.title}</h1>

      <Block title={P.prescriptions} onAdd={() => setEditing({ what: 'prescription' })}>
        {plan.prescriptions.map((p) => (
          <Item key={p.id} onEdit={() => setEditing({ what: 'prescription', item: p })}
            title={p.title} meta={[P.kinds[p.kind], p.dose, p.schedule?.times.join(', '), p.schedule?.withFood ? P.withFood.toLowerCase() : undefined,
              p.dueDate ? `${P.dueDate.toLowerCase()} ${dmy(p.dueDate)}` : undefined]} note={p.notes} source={p.source} />
        ))}
      </Block>

      <Block title={P.constraints} onAdd={() => setEditing({ what: 'constraint' })}>
        {plan.constraints.map((c) => (
          <li key={c.id} className="flex items-start gap-2 border-t border-line px-3 py-2 first:border-t-0">
            <label className="flex min-h-tap min-w-tap items-center justify-center">
              <input type="checkbox" checked={c.active} aria-label={`${c.title}: ${c.active ? P.active : P.inactive}`}
                onChange={(e) => save({ constraints: plan.constraints.map((x) => (x.id === c.id ? { ...x, active: e.target.checked } : x)) })}
                className="h-5 w-5 accent-[rgb(var(--accent))]" />
            </label>
            <div className={`min-w-0 flex-1 py-2 ${c.active ? '' : 'opacity-60'}`}>
              <p className="font-medium">{c.title}{c.title !== P.tags[c.tag] && <span className="text-sm font-normal text-muted"> · {P.tags[c.tag]}</span>}</p>
              {c.reason && <p className="text-sm">{c.reason}</p>}
              <p className="text-sm text-muted">{c.source}</p>
            </div>
            <EditButton label={c.title} onClick={() => setEditing({ what: 'constraint', item: c })} />
          </li>
        ))}
      </Block>

      <Block title={P.targets} onAdd={() => setEditing({ what: 'targets' })} addLabel={P.edit}>
        <li className="px-3 py-2">{targetSummary(tg) || <span className="text-muted">{P.noTargets}</span>}</li>
      </Block>

      <Block title={P.modes} onAdd={() => setEditing({ what: 'mode' })}>
        {plan.modes.map((m) => (
          <Item key={m.id} onEdit={() => setEditing({ what: 'mode', item: m })} title={m.title}
            meta={[`${dmy(m.from)} — ${dmy(m.to)}`, targetSummary(m.targetsOverride) || undefined]} note={m.notes.join(' · ')} />
        ))}
      </Block>

      <Block title={P.checkup} onAdd={() => setEditing({ what: 'checkup' })} addLabel={plan.nextCheckup ? P.edit : P.add}>
        {plan.nextCheckup && <li className="px-3 py-2"><p className="font-medium">{dmy(plan.nextCheckup.date)}</p>
          <p className="text-sm text-muted">{plan.nextCheckup.tests.join(', ')}</p></li>}
      </Block>

      <p className="pb-2 text-sm text-muted">{P.disclaimer}</p>

      {editing?.what === 'prescription' && <PrescriptionForm plan={plan} item={editing.item} onClose={() => setEditing(null)} />}
      {editing?.what === 'constraint' && <ConstraintForm plan={plan} item={editing.item} onClose={() => setEditing(null)} />}
      {editing?.what === 'mode' && <ModeForm plan={plan} item={editing.item} onClose={() => setEditing(null)} />}
      {editing?.what === 'targets' && <TargetsForm plan={plan} onClose={() => setEditing(null)} />}
      {editing?.what === 'checkup' && <CheckupForm plan={plan} onClose={() => setEditing(null)} />}
      <PlanVersions current={plan} />
    </section>
  );
}

function targetSummary(tg: Partial<Targets>): string {
  const parts = [
    tg.kcal != null && `${tg.kcal} ккал`, tg.proteinG != null && `білок ${tg.proteinG} г`,
    tg.carbsG?.min != null && `вуглеводи не менше ${tg.carbsG.min} г`, tg.carbsG?.max != null && `вуглеводи до ${tg.carbsG.max} г`,
    tg.fatG != null && `жири ${tg.fatG} г`, tg.calciumMg != null && `кальцій ${tg.calciumMg} мг`, tg.waterMl != null && `вода ${tg.waterMl} мл`,
    tg.lastMealBy && `їжа до ${tg.lastMealBy}`, tg.weightGoalKg != null && `вага ${tg.weightGoalKg} кг`,
    tg.maxWeightLossKgPerWeek != null && `не швидше ${tg.maxWeightLossKgPerWeek} кг/тиждень`,
  ];
  return parts.filter(Boolean).join(' · ');
}

// ------------------------------------------------------------------ layout pieces
function Block({ title, onAdd, addLabel = P.add, children }: { title: string; onAdd: () => void; addLabel?: string; children: ReactNode }) {
  const list = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-1">
        <h2 className="font-semibold">{title}</h2>
        <button type="button" onClick={onAdd} className="flex min-h-tap items-center gap-1 px-2 text-accent">
          {addLabel === P.add && <Plus size={18} aria-hidden />}{addLabel}</button>
      </div>
      {list.length ? <ul>{children}</ul> : <p className="px-3 py-3 text-muted">{P.empty}</p>}
    </section>
  );
}

function Item({ title, meta, note, source, onEdit }: { title: string; meta: (string | undefined)[]; note?: string; source?: string; onEdit: () => void }) {
  return (
    <li className="flex items-start gap-2 border-t border-line px-3 py-2 first:border-t-0">
      <div className="min-w-0 flex-1 py-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted">{meta.filter(Boolean).join(' · ')}</p>
        {note && <p className="text-sm">{note}</p>}
        {source && <p className="text-sm text-muted">{source}</p>}
      </div>
      <EditButton label={title} onClick={onEdit} />
    </li>
  );
}

const EditButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" onClick={onClick} aria-label={`${P.edit}: ${label}`} className="flex min-h-tap min-w-tap items-center justify-center text-muted">
    <Pencil size={18} /></button>
);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="text-sm text-muted">{label}</span>{children}</label>;
}

function FormSheet({ title, onClose, onSave, onDelete, children }: {
  title: string; onClose: () => void; onSave: () => Promise<unknown> | void; onDelete?: () => Promise<unknown> | void; children: ReactNode;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <form className="max-h-[70dvh] space-y-3 overflow-y-auto" onSubmit={async (e) => { e.preventDefault(); await onSave(); onClose(); }}>
        {children}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="submit" className="min-h-tap flex-1 rounded-xl bg-accent px-4 font-medium text-surface">{P.save}</button>
          <button type="button" onClick={onClose} className="min-h-tap rounded-xl border border-line px-4">{P.cancel}</button>
          {onDelete && <button type="button" onClick={async () => { await onDelete(); onClose(); }}
            className="min-h-tap rounded-xl px-3 text-warn">{P.delete}</button>}
        </div>
      </form>
    </Sheet>
  );
}

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
const num = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));
const str = (n: number | undefined) => (n == null ? '' : String(n));

// ------------------------------------------------------------------ forms
function PrescriptionForm({ plan, item, onClose }: { plan: PlanRow; item?: Prescription; onClose: () => void }) {
  const [p, setP] = useState<Prescription>(item ?? { id: newId(), kind: 'medication', title: '', source: '' });
  const [times, setTimes] = useState(item?.schedule?.times.join(', ') ?? '');
  const onSave = () => {
    const ts = times.split(',').map((x) => x.trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x)).map((x) => x.padStart(5, '0'));
    const next: Prescription = { ...p, title: p.title.trim(), ...(ts.length ? { schedule: { times: ts, withFood: p.schedule?.withFood ?? false } } : { schedule: undefined }) };
    return save({ prescriptions: upsert(plan.prescriptions, next) });
  };
  return (
    <FormSheet title={item ? P.edit : P.prescriptions} onClose={onClose} onSave={onSave}
      onDelete={item ? () => save({ prescriptions: plan.prescriptions.filter((x) => x.id !== item.id) }) : undefined}>
      <Field label={P.title_}><input required value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} className={field} /></Field>
      <Field label={P.kind}>
        <select value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as Prescription['kind'] })} className={field}>
          {KINDS.map((k) => <option key={k} value={k}>{P.kinds[k]}</option>)}</select></Field>
      <Field label={P.dose}><input value={p.dose ?? ''} onChange={(e) => setP({ ...p, dose: e.target.value || undefined })} className={field} /></Field>
      <Field label={P.times}><input value={times} onChange={(e) => setTimes(e.target.value)} placeholder="08:30" className={field} /></Field>
      <label className="flex min-h-tap items-center gap-3">
        <input type="checkbox" checked={p.schedule?.withFood ?? false} className="h-5 w-5 accent-[rgb(var(--accent))]"
          onChange={(e) => setP({ ...p, schedule: { times: p.schedule?.times ?? [], withFood: e.target.checked } })} />
        <span>{P.withFood}</span></label>
      <Field label={P.dueDate}><input type="date" value={p.dueDate ?? ''} onChange={(e) => setP({ ...p, dueDate: e.target.value || undefined })} className={field} /></Field>
      <Field label={P.notes}><input value={p.notes ?? ''} onChange={(e) => setP({ ...p, notes: e.target.value || undefined })} className={field} /></Field>
      <Field label={P.source}><input value={p.source} onChange={(e) => setP({ ...p, source: e.target.value })} placeholder="Ендокринолог 02.10.2026" className={field} /></Field>
    </FormSheet>
  );
}

function ConstraintForm({ plan, item, onClose }: { plan: PlanRow; item?: Constraint; onClose: () => void }) {
  const [c, setC] = useState<Constraint>(item ?? { id: newId(), tag: 'custom', title: '', reason: '', source: '', active: true });
  return (
    <FormSheet title={item ? P.edit : P.constraints} onClose={onClose}
      onSave={() => save({ constraints: upsert(plan.constraints, { ...c, title: c.title.trim() || P.tags[c.tag] }) })}
      onDelete={item ? () => save({ constraints: plan.constraints.filter((x) => x.id !== item.id) }) : undefined}>
      <Field label={P.tag}>
        <select value={c.tag} onChange={(e) => setC({ ...c, tag: e.target.value as ConstraintTag })} className={field}>
          {TAGS.map((tag) => <option key={tag} value={tag}>{P.tags[tag]}</option>)}</select></Field>
      <Field label={P.title_}><input value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} placeholder={P.tags[c.tag]} className={field} /></Field>
      <Field label={P.reason}><textarea value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value })} rows={2} className={`${field} py-2`} /></Field>
      <Field label={P.source}><input value={c.source} onChange={(e) => setC({ ...c, source: e.target.value })} placeholder="Уролог, 2025" className={field} /></Field>
      <label className="flex min-h-tap items-center gap-3">
        <input type="checkbox" checked={c.active} onChange={(e) => setC({ ...c, active: e.target.checked })} className="h-5 w-5 accent-[rgb(var(--accent))]" />
        <span>{P.active}</span></label>
    </FormSheet>
  );
}

export function TargetFields({ value, onChange }: { value: Partial<Targets>; onChange: (v: Partial<Targets>) => void }) {
  const T = P.target;
  const n = (key: 'kcal' | 'proteinG' | 'fatG' | 'calciumMg' | 'waterMl' | 'weightGoalKg' | 'maxWeightLossKgPerWeek') => (
    <Field label={T[key]}><input inputMode="decimal" value={str(value[key])} onChange={(e) => onChange({ ...value, [key]: num(e.target.value) })} className={field} /></Field>
  );
  const carbs = (k: 'min' | 'max') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...value.carbsG, [k]: num(e.target.value) };
    onChange({ ...value, carbsG: next.min == null && next.max == null ? undefined : next });
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      {n('kcal')}{n('proteinG')}
      <Field label={T.carbsMin}><input inputMode="decimal" value={str(value.carbsG?.min)} onChange={carbs('min')} className={field} /></Field>
      <Field label={T.carbsMax}><input inputMode="decimal" value={str(value.carbsG?.max)} onChange={carbs('max')} className={field} /></Field>
      {n('fatG')}{n('calciumMg')}{n('waterMl')}
      <Field label={T.lastMealBy}><input type="time" value={value.lastMealBy ?? ''} onChange={(e) => onChange({ ...value, lastMealBy: e.target.value || undefined })} className={field} /></Field>
      {n('weightGoalKg')}{n('maxWeightLossKgPerWeek')}
    </div>
  );
}

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !Number.isNaN(v))) as T;

function TargetsForm({ plan, onClose }: { plan: PlanRow; onClose: () => void }) {
  const [tg, setTg] = useState<Partial<Targets>>(plan.targets);
  return (
    <FormSheet title={P.targets} onClose={onClose} onSave={() => save({ targets: clean(tg) })}>
      <TargetFields value={tg} onChange={setTg} />
    </FormSheet>
  );
}

function ModeForm({ plan, item, onClose }: { plan: PlanRow; item?: Mode; onClose: () => void }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [m, setM] = useState<Mode>(item ?? { id: newId(), title: '', from: today, to: today, targetsOverride: {}, notes: [] });
  const [notes, setNotes] = useState(m.notes.join('\n'));
  const onSave = () => save({ modes: upsert(plan.modes, { ...m, title: m.title.trim(), to: m.to < m.from ? m.from : m.to,
    targetsOverride: clean(m.targetsOverride), notes: notes.split('\n').map((x) => x.trim()).filter(Boolean) }) });
  return (
    <FormSheet title={item ? P.edit : P.modes} onClose={onClose} onSave={onSave}
      onDelete={item ? () => save({ modes: plan.modes.filter((x) => x.id !== item.id) }) : undefined}>
      <Field label={P.title_}><input required value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} placeholder="Підготовка до ОГТТ" className={field} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={P.from}><input type="date" required value={m.from} onChange={(e) => setM({ ...m, from: e.target.value })} className={field} /></Field>
        <Field label={P.to}><input type="date" required value={m.to} onChange={(e) => setM({ ...m, to: e.target.value })} className={field} /></Field>
      </div>
      <p className="text-sm text-muted">{P.modeTargets}</p>
      <TargetFields value={m.targetsOverride} onChange={(v) => setM({ ...m, targetsOverride: v })} />
      <Field label={P.notesLines}><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${field} py-2`} /></Field>
    </FormSheet>
  );
}

function CheckupForm({ plan, onClose }: { plan: PlanRow; onClose: () => void }) {
  const [date, setDate] = useState(plan.nextCheckup?.date ?? '');
  const [tests, setTests] = useState(plan.nextCheckup?.tests.join('\n') ?? '');
  const onSave = () => save({ nextCheckup: date ? { date, tests: tests.split('\n').map((x) => x.trim()).filter(Boolean) } : undefined });
  return (
    <FormSheet title={P.checkup} onClose={onClose} onSave={onSave}
      onDelete={plan.nextCheckup ? () => save({ nextCheckup: undefined }) : undefined}>
      <Field label={P.date}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} /></Field>
      <Field label={P.tests}><textarea value={tests} onChange={(e) => setTests(e.target.value)} rows={3} placeholder="Глюкоза натщесерце&#10;Феритин" className={`${field} py-2`} /></Field>
    </FormSheet>
  );
}
