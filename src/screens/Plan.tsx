import { format, parseISO } from 'date-fns';
import { ExampleNotice } from '../components/ExampleNotice';
import { PlanScan } from '../components/PlanScan';
import { timesToSet } from '../domain/conclusion';
import { PlanVersions } from '../components/PlanVersions';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { uk } from 'date-fns/locale';
import { Pencil, Plus } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState, type ReactNode } from 'react';
import { useMedIndex } from '../data/medsIndex';
import { MedboxScan } from '../components/MedboxScan';
import { DietNorms, DietPicker } from '../components/DietPicker';
import { dietConflicts, dietOf, fillEmptyTargets } from '../domain/diets';
import { duplicateInn, searchMeds } from '../domain/meds';
import { Sheet } from '../components/Sheet';
import { db, type PlanRow } from '../data/db';
import { useAllEntries, usePlan } from '../data/queries';
import { stockLeft } from '../domain/stock';
import { atLocal, newId, sinceNow, todayISO } from '../domain/dates';
import { AllergenPicker } from '../components/AllergenPicker';
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
  const entries = useAllEntries(); // D69: what is left of each medicine
  const plan = usePlan();
  const [editing, setEditing] = useState<Editing | null>(null);
  const pieces = useLiveQuery(async () => new Map((await db.pieces.toArray()).map((x) => [x.id, x.url])), []); // D114
  if (!plan) return <Loading />;
  const tg = plan.targets;

  return (
    <section className="space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">{P.title}</h1>
      <ExampleNotice plan={plan} />
      <PlanScan plan={plan} />

      {duplicateInn(plan.prescriptions).map((d) => ( /* D89: information, never «не приймайте» */
        <p key={d.inn} role="status" className="rounded-2xl border border-line bg-surface p-3 text-sm">{P.duplicate(d.titles, d.inn)}</p>
      ))}
      <Block title={P.prescriptions} onAdd={() => setEditing({ what: 'prescription' })}>
        {plan.prescriptions.filter((p) => p.kind !== 'test').map((p) => ( /* D104: tests live with the next checkup */
          <Item key={p.id} onEdit={() => setEditing({ what: 'prescription', item: p })} piece={pieces?.get(p.id)}
            title={p.title} meta={[P.kinds[p.kind], (p.kind === 'medication' || p.kind === 'supplement') ? (p.med ? p.med.inn : P.offRegistry) : undefined, p.dose, p.asNeeded ? t.conclusion.asNeeded : p.schedule?.times.join(', '),
              p.schedule?.withFood === true ? P.withFood.toLowerCase() : p.schedule?.withFood === false ? t.conclusion.empty : undefined,
              p.until ? (p.until < todayISO() ? P.courseOver(dmy(p.until)) : P.courseUntil(dmy(p.until))) : undefined, // D103: the course end in the list
              p.dueDate ? `${P.dueDate.toLowerCase()} ${dmy(p.dueDate)}` : undefined,
              ...(entries && stockLeft(p, entries) ? [P.stockDays(stockLeft(p, entries)!.days)] : [])]} note={p.notes} source={p.source}
            warn={timesToSet(p) ? P.setTimes(timesToSet(p)!) : undefined} />
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
              {pieces?.get(c.id) && <Paper url={pieces.get(c.id)!} title={c.title} />}
              {c.tag === 'diet' && dietOf(c.diet) && (() => { const d = dietOf(c.diet)!; return ( /* D90: the preset's rules, each can be switched off */
                <div className="mt-1 space-y-1">
                  {!d.verified && <p className="text-xs text-warn">{t.diet.unverified}</p>}
                  <DietNorms d={d} />
                  {d.rules.filter((r) => r.checkedBy).map((r) => (
                    <label key={r.id} className="flex min-h-tap items-center gap-2 text-sm">
                      <input type="checkbox" checked={!c.off?.includes(r.id)} className="h-5 w-5 accent-[rgb(var(--accent))]"
                        onChange={(e) => save({ constraints: plan.constraints.map((x) => (x.id === c.id
                          ? { ...x, off: e.target.checked ? (x.off ?? []).filter((o) => o !== r.id) : [...(x.off ?? []), r.id] } : x)) })} />
                      <span>{r.title}</span></label>
                  ))}
                  {!d.rules.some((r) => r.checkedBy) && <p className="text-xs text-muted">{t.diet.noRules}</p>}
                </div>
              ); })()}
            </div>
            <EditButton label={c.title} onClick={() => setEditing({ what: 'constraint', item: c })} />
          </li>
        ))}
      </Block>

      <Block title={P.targets} onAdd={() => setEditing({ what: 'targets' })} addLabel={P.edit}>
        <li className="px-3 py-2">{targetSummary(tg) || <span className="text-muted">{P.noTargets}</span>}</li>
        {dietConflicts(plan).map((x) => ( /* D90: a doctor's target and a diet's norm that differ — a question, not settled */
          <li key={x.code + x.field} role="status" className="border-t border-line px-3 py-2 text-sm text-warn">
            {t.diet.conflict(x.code, t.diet.fields[x.field], x.target, x.range[0], x.range[1])}</li>
        ))}
      </Block>

      <Block title={P.modes} onAdd={() => setEditing({ what: 'mode' })}>
        {plan.modes.map((m) => (
          <Item key={m.id} onEdit={() => setEditing({ what: 'mode', item: m })} title={m.title}
            meta={[`${dmy(m.from)} — ${dmy(m.to)}`, targetSummary(m.targetsOverride) || undefined]} note={m.notes.join(' · ')} />
        ))}
      </Block>

      <Block title={P.checkup} onAdd={() => setEditing({ what: 'checkup' })} addLabel={plan.nextCheckup ? P.edit : P.add}>
        {plan.nextCheckup && <li className="px-3 py-2"><p className="font-medium">{dmy(plan.nextCheckup.date)}</p>
          <p className="text-sm text-muted">{plan.nextCheckup.tests.join(', ')}</p>
          {pieces?.get('checkup') && <Paper url={pieces.get('checkup')!} title={P.checkup} />}</li>}
        {plan.prescriptions.filter((p) => p.kind === 'test').map((p) => ( /* D104: tests to take, next to the visit — not among the medicines */
          <Item key={p.id} onEdit={() => setEditing({ what: 'prescription', item: p })} title={p.title} piece={pieces?.get(p.id)}
            meta={[P.kinds.test, p.dueDate ? `${P.dueDate.toLowerCase()} ${dmy(p.dueDate)}` : undefined]} note={p.notes} source={p.source} />
        ))}
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

/** D114: the line as it was on the doctor's paper — the piece kept on this device, opened on a tap. */
function Paper({ url, title }: { url: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-1 min-h-[2rem] text-sm text-accent underline">{open ? P.paperHide : P.paper}</button>
      {open && <img src={url} alt={P.paperAlt(title)} className="mt-1 max-h-32 max-w-full rounded border border-line" />}
    </div>
  );
}

function Item({ title, meta, note, source, warn, onEdit, piece }: { title: string; meta: (string | undefined)[]; note?: string; source?: string; warn?: string; onEdit: () => void; piece?: string }) {
  return (
    <li className="flex items-start gap-2 border-t border-line px-3 py-2 first:border-t-0">
      <div className="min-w-0 flex-1 py-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted">{meta.filter(Boolean).join(' · ')}</p>
        {note && <p className="text-sm">{note}</p>}
        {source && <p className="text-sm text-muted">{source}</p>}
        {piece && <Paper url={piece} title={title} />}
        {warn && <p className="mt-1 text-sm font-medium text-warn">{warn}</p>}
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

function FormSheet({ title, onClose, onSave, onDelete, children, blocked }: {
  title: string; onClose: () => void; onSave: () => Promise<unknown> | void; onDelete?: () => Promise<unknown> | void; children: ReactNode;
  blocked?: string; // D100: why it cannot be saved yet — said next to the button, the button off
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <form className="max-h-[70dvh] space-y-3 overflow-y-auto" onSubmit={async (e) => { e.preventDefault(); if (blocked) return; await onSave(); onClose(); }}>
        {children}
        {blocked && <p role="status" className="text-sm text-warn">{blocked}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="submit" disabled={!!blocked} className="min-h-tap flex-1 rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">{P.save}</button>
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
  const [p, setP] = useState<Prescription>(item ?? { id: newId(), kind: 'medication', title: '', source: '', ...sinceNow() }); // D97, D103
  const [times, setTimes] = useState(item?.schedule?.times.join(', ') ?? '');
  const entries = useAllEntries();
  const now = item && entries ? stockLeft(item, entries) : undefined;
  const [left, setLeft] = useState(now ? String(now.left) : ''); // D69: what is in the pack now
  const [perDose, setPerDose] = useState(String(item?.stock?.perDose ?? 1));
  const drug = p.kind === 'medication' || p.kind === 'supplement';
  const index = useMedIndex(drug); // D89: the register on the device — names only, never a dose
  const suggestions = useMemo(() => (index && drug && !p.med ? searchMeds(index, p.title, 5) : []), [index, drug, p.med, p.title]);
  const onSave = () => {
    const ts = times.split(',').map((x) => x.trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x)).map((x) => x.padStart(5, '0'));
    const n = Number(left.replace(',', '.')), per = Number(perDose.replace(',', '.')) || 1;
    const counted = left.trim() === '' ? undefined : String(n) === String(now?.left) && per === item?.stock?.perDose ? item.stock
      : { left: n, perDose: per, at: atLocal(todayISO(), format(new Date(), 'HH:mm')) };
    const { stock: _s, ...rest } = p;
    const next: Prescription = { ...rest, title: p.title.trim(), ...(ts.length ? { schedule: { times: ts, withFood: p.schedule?.withFood ?? false } } : { schedule: undefined }),
      ...(counted && n >= 0 ? { stock: counted } : {}) };
    return save({ prescriptions: upsert(plan.prescriptions, next) });
  };
  return (
    <FormSheet title={item ? P.edit : P.prescriptions} onClose={onClose} onSave={onSave}
      blocked={drug && p.title.trim() ? (!p.dose?.trim() ? P.needDose : !times.trim() && !p.asNeeded ? P.needTime : undefined) : undefined}
      onDelete={item ? () => save({ prescriptions: plan.prescriptions.filter((x) => x.id !== item.id) }) : undefined}>
      <Field label={P.title_}><input required value={p.title} placeholder={drug ? P.medSearch : undefined} className={field}
        onChange={(e) => { const title = e.target.value; const { med: _m, ...rest } = p; setP(p.med && title === p.med.name ? p : { ...rest, title }); }} /></Field>
      {drug && <MedboxScan onRead={(r) => { // D89: the box's name, matched in the register when it is there
        const e = index && r.name ? searchMeds(index, r.name, 1)[0] ?? (r.inn ? searchMeds(index, r.inn, 1)[0] : undefined) : undefined;
        const { med: _m, ...rest } = p;
        setP(e ? { ...p, title: e.name, med: { name: e.name, ...(e.inn ? { inn: e.inn } : {}), ...(e.atc ? { atc: e.atc } : {}) } } : { ...rest, title: r.name ?? p.title });
      }} />}
      {drug && (p.med ? <p className="-mt-2 text-sm text-muted">{P.fromRegistry}{p.med.inn ? ` · ${p.med.inn}` : ''}</p>
        : p.title.trim().length >= 2 && (
          <div className="-mt-2 space-y-1">
            {suggestions.map((e) => (
              <button key={e.name + e.inn} type="button" onClick={() => setP({ ...p, title: e.name, med: { name: e.name, ...(e.inn ? { inn: e.inn } : {}), ...(e.atc ? { atc: e.atc } : {}) } })}
                className="block min-h-tap w-full rounded-xl border border-line px-3 py-1 text-left">
                <span className="block font-medium">{e.name}{e.inn && <span className="font-normal text-muted"> · {e.inn}</span>}</span>
                <span className="block text-xs text-muted">{P.medInfo(e.form, e.doses)}</span></button>
            ))}
            <p className="text-xs text-muted">{suggestions.length ? '' : `${P.offRegistry} · `}{index?.source}</p>
          </div>
        ))}
      <Field label={P.kind}>
        <select value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as Prescription['kind'] })} className={field}>
          {KINDS.map((k) => <option key={k} value={k}>{P.kinds[k]}</option>)}</select></Field>
      <Field label={P.dose}><input value={p.dose ?? ''} onChange={(e) => setP({ ...p, dose: e.target.value || undefined })} className={field} /></Field>
      {drug && <p className={`-mt-2 text-xs ${p.dose?.trim() ? 'text-muted' : 'text-warn'}`}>{p.dose?.trim() ? P.medDoseNote : P.noDose}</p>}
      <Field label={P.times}><input value={times} onChange={(e) => setTimes(e.target.value)} placeholder={P.timesPh} className={field} /></Field>
      {drug && (
        <label className="-mt-1 flex min-h-tap items-center gap-3">
          <input type="checkbox" checked={!!p.asNeeded} onChange={(e) => { const { asNeeded: _a, ...rest } = p; setP(e.target.checked ? { ...p, asNeeded: true } : rest); }}
            className="h-5 w-5 accent-[rgb(var(--accent))]" /><span>{P.asNeeded}</span></label>
      )}
      {drug && (
        <Field label={P.until}><input type="date" value={p.until ?? ''} min={p.since} onChange={(e) => { const { until: _u, ...rest } = p; setP(e.target.value ? { ...p, until: e.target.value } : rest); }} className={field} /></Field>
      )}
      <label className="flex min-h-tap items-center gap-3">
        <input type="checkbox" checked={p.schedule?.withFood ?? false} className="h-5 w-5 accent-[rgb(var(--accent))]"
          onChange={(e) => setP({ ...p, schedule: { times: p.schedule?.times ?? [], withFood: e.target.checked } })} />
        <span>{P.withFood}</span></label>
      {(p.kind === 'medication' || p.kind === 'supplement') && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={P.stockLeft}><input inputMode="numeric" value={left} onChange={(e) => setLeft(e.target.value)} placeholder={P.stockPh} className={field} /></Field>
          <Field label={P.perDose}><input inputMode="decimal" value={perDose} onChange={(e) => setPerDose(e.target.value)} className={field} /></Field>
        </div>
      )}
      <Field label={P.dueDate}><input type="date" value={p.dueDate ?? ''} onChange={(e) => setP({ ...p, dueDate: e.target.value || undefined })} className={field} /></Field>
      <Field label={P.notes}><input value={p.notes ?? ''} onChange={(e) => setP({ ...p, notes: e.target.value || undefined })} className={field} /></Field>
      <Field label={P.source}><input value={p.source} onChange={(e) => setP({ ...p, source: e.target.value })} placeholder="Ендокринолог 02.10.2026" className={field} /></Field>
    </FormSheet>
  );
}

function ConstraintForm({ plan, item, onClose }: { plan: PlanRow; item?: Constraint; onClose: () => void }) {
  const [c, setC] = useState<Constraint>(item ?? { id: newId(), tag: 'custom', title: '', reason: '', source: '', active: true });
  const [fill, setFill] = useState(false); // D90: the diet's norms into empty targets — only when asked
  const d = c.tag === 'diet' ? dietOf(c.diet) : undefined;
  return (
    <FormSheet title={item ? P.edit : P.constraints} onClose={onClose}
      onSave={() => save({ constraints: upsert(plan.constraints, { ...c, title: c.title.trim()
        || (c.tag === 'allergy' && c.allergens?.length ? P.allergyTitle(c.allergens.map((a) => t.allergen.name[a]).join(', ')) : P.tags[c.tag]) }),
        ...(d && fill ? { targets: fillEmptyTargets(plan.targets, d) } : {}) })}
      onDelete={item ? () => save({ constraints: plan.constraints.filter((x) => x.id !== item.id) }) : undefined}>
      <Field label={P.tag}>
        <select value={c.tag} onChange={(e) => setC({ ...c, tag: e.target.value as ConstraintTag })} className={field}>
          {TAGS.map((tag) => <option key={tag} value={tag}>{P.tags[tag]}</option>)}</select></Field>
      {c.tag === 'allergy' && <AllergenPicker legend={P.allergyPick} value={c.allergens ?? []} onChange={(v) => setC({ ...c, allergens: v })} />}
      {c.tag === 'diet' && <DietPicker value={c.diet} fill={fill} onFill={setFill}
        onPick={(x) => setC({ ...c, diet: x.code, title: `${x.code} — ${x.name}`, source: c.source || 'Наказ МОЗ №931' })} />}
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
