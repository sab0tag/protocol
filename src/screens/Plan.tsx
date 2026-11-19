import { DoctorSaid } from '../components/DoctorSaid';
import { format, parseISO } from 'date-fns';
import { ExampleNotice } from '../components/ExampleNotice';
import { readTimes, timesToSet } from '../domain/conclusion';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { uk } from 'date-fns/locale';
import { Pencil, Plus } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { activeProfileId } from '../data/profiles';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useFeatures } from '../app/features';
import { PlanModuleReview } from '../components/PlanModuleReview';
import { ACTIVITY_KINDS, planModuleSuggestions } from '../domain/moduleStart';
import { useMedIndex } from '../data/medsIndex';
import { MedboxScan } from '../components/MedboxScan';
import { DietNorms, DietPicker } from '../components/DietPicker';
import { DIET_SOURCE, dietConflicts, dietCoverage, dietOf, fillEmptyTargets, ownTargets } from '../domain/diets';
import { duplicateInn, searchMeds } from '../domain/meds';
import { prnLimit } from '../domain/prn';
import { prnLimitText } from '../domain/report';
import { Sheet } from '../components/Sheet';
import { db, type PlanRow } from '../data/db';
import { useAllEntries, useModuleEvents, usePlan } from '../data/queries';
import { stockLeft } from '../domain/stock';
import { atLocal, newId, sinceNow, todayISO } from '../domain/dates';
import { AllergenPicker } from '../components/AllergenPicker';
import { LIMIT_UNITS, type BodyPart, type Restriction, type RestrictionKind, type Constraint, type ConstraintTag, type DailyLimit, type Mode, type Plan as PlanT, type Prescription, type Targets } from '../domain/types';
import { countOnce } from '../data/tally';
import { activateClinicPlan } from '../data/carePlans';
import { t } from '../i18n/uk';
import { BODY_PARTS, restrictionText } from '../domain/trainingRules';
import { currentStage, readRehab, rehabText } from '../domain/rehab';

const P = t.plan;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const TAGS = Object.keys(P.tags) as ConstraintTag[];
const KINDS = Object.keys(P.kinds) as Prescription['kind'][];

type Editing =
  | { what: 'prescription'; item?: Prescription }
  | { what: 'constraint'; item?: Constraint }
  | { what: 'mode'; item?: Mode }
  | { what: 'restriction'; item?: Restriction }
  | { what: 'rehab' }
  | { what: 'targets' }
  | { what: 'checkup' };

const save = (patch: Partial<PlanT>) => saved(db.plan.update('main', patch), t.toast.plan);
/** D119: a line read off the doctor's paper (it has its piece, D114) corrected by the person — a measure of the reading */
async function photoEdited(id: string, was: unknown[], now: unknown[]) {
  if (JSON.stringify(was) === JSON.stringify(now) || !(await db.pieces.get(id).catch(() => undefined))) return;
  await countOnce('photo_edit', id);
}
const dmy = (d: string) => format(parseISO(d), 'd MMMM', { locale: uk });

export type PlanSection = 'home' | 'prescriptions' | 'constraints' | 'goals' | 'checkup';

/** «План лікаря»: what the doctor said, as the user entered it. Nothing here is decided by the app. */
export function Plan({ section = 'home' }: { section?: PlanSection }) {
  const { enabled } = useFeatures();
  const events = useModuleEvents();
  const location = useLocation(), navigate = useNavigate();
  const [review, setReview] = useState<{ before: PlanT; after: PlanT } | null>(() => (location.state as { moduleReview?: { before: PlanT; after: PlanT } } | null)?.moduleReview ?? null);
  const previous = useRef<PlanRow>();
  const entries = useAllEntries(); // D69: what is left of each medicine
  const plan = usePlan();
  const clinicDrafts = useLiveQuery(async () => {
    const plans = await db.carePlans.toArray();
    const drafts = plans.filter(p => p.personId === activeProfileId && p.source.kind === 'clinic' && p.status === 'draft');
    return Promise.all(drafts.map(async draft => ({ plan: draft, items: await db.carePlanItems.where('[personId+planId]').equals([activeProfileId, draft.id]).toArray() })));
  }, []);
  useEffect(() => {
    if (!plan || !events) return;
    const before = previous.current; previous.current = plan;
    if (enabled && before && planModuleSuggestions(before, plan, events).length) setReview((prior) => ({ before: prior?.before ?? before, after: plan }));
  }, [plan, events, enabled]);
  useEffect(() => { if ((location.state as { moduleReview?: unknown } | null)?.moduleReview) navigate(location.pathname, { replace: true, state: null }); }, []); // consume a completed repeat-onboarding review once
  const [addingPlan, setAddingPlan] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const pieces = useLiveQuery(async () => new Map((await db.pieces.toArray()).map((x) => [x.id, x.url])), []); // D114
  if (!plan) return <Loading />;
  const tg = plan.targets;
  const prescriptions = plan.prescriptions.filter((p) => p.kind !== 'test');
  const goalsPreview = [targetSummary(tg), plan.modes.length ? `${P.summaryModes} ${plan.modes.map((mode) => mode.title).join(' · ')}` : '']
    .filter(Boolean).join(' · ');
  const sectionTitle = section === 'prescriptions' ? P.prescriptions
    : section === 'constraints' ? P.constraints
      : section === 'goals' ? P.targets
        : section === 'checkup' ? P.checkup : P.title;

  return (
    <section className="space-y-4 pt-4">
      {section === 'home' ? <header className="protocol-plan-heading flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-semibold tracking-tight">{t.said.title}</h1><button type="button" className="protocol-action" onClick={() => setAddingPlan(true)}><Plus size={18} aria-hidden />{t.said.newConclusion}</button></header> : (
        <header className="protocol-scene-header space-y-2">
          <h1 className="text-2xl font-semibold">{sectionTitle}</h1>
        </header>
      )}
      <ExampleNotice plan={plan} />
      {section === 'home' && <DoctorSaid plan={plan} pieces={pieces} goals={goalsPreview} />}
      {section === 'home' && !!clinicDrafts?.length && <section className="protocol-card space-y-3 p-4" aria-label="Чернетки від клінік">
        <h2 className="text-lg font-semibold">Отримані плани від клінік</h2>
        <p className="text-sm text-muted">Ці призначення збережено окремо від поточного плану. Вони не створюють щоденних завдань або нагадувань, поки ви не перевірите їх із лікарем.</p>
        {clinicDrafts?.map(({ plan: draft, items }) => <article key={draft.id} className="rounded-xl border border-line p-3">
          <h3 className="font-semibold break-words">{draft.title}</h3>
          <p className="text-sm text-muted break-words">{draft.clinicianRef} · {items.length} пунктів · Чернетка</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{items.map(item => <li key={item.id} className="break-words">{item.content.type === 'prescription' ? item.content.value.title : item.kind} — потребує перевірки</li>)}</ul>
          <details className="mt-3 text-sm">
            <summary className="min-h-tap cursor-pointer rounded-lg py-3 font-medium text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Переглянути повний текст призначення</summary>
            <p className="mb-3 text-muted">Звірте назви, дози, частоту та тривалість із призначенням лікаря. Перегляд не активує план.</p>
            <ul className="space-y-3">{items.map(item => <li key={item.id} className="rounded-lg bg-bg p-3 [overflow-wrap:anywhere]">
              <p className="whitespace-pre-wrap">{item.provenance.text || (item.content.type === 'prescription' ? item.content.value.title : item.kind)}</p>
              {item.content.type === 'prescription' && item.content.value.source && <p className="mt-1 text-muted">Джерело: {item.content.value.source}</p>}
              <p className="mt-1 text-muted">Потребує перевірки. Розклад ще не створено.</p>
            </li>)}</ul>
          </details>
          <ClinicActivate title={draft.title} onActivate={async () => {
            const result = await activateClinicPlan(db, activeProfileId, draft.id);
            if (result === 'activated') navigate('/plan/prescriptions');
          }} />
        </article>)}
      </section>}
      {addingPlan && <Sheet title={t.planView.add} onClose={() => setAddingPlan(false)}>
        <nav aria-label={t.planView.add} className="space-y-3">
          <Link to="/plan/scan" onClick={() => setAddingPlan(false)} className="protocol-action flex">{t.conclusion.button}</Link>
          <p className="text-sm text-muted">{t.planView.photoHint}</p>
          <Link to="/plan/import" onClick={() => setAddingPlan(false)} className="protocol-action-secondary flex">{t.planView.qr}</Link>
          <Link to="/plan/prescriptions" onClick={() => setAddingPlan(false)} className="protocol-action-secondary flex">{t.planView.manual}</Link>
        </nav>
      </Sheet>}
      {review && <PlanModuleReview before={review.before} after={plan} onClose={() => setReview(null)} />}

      {section === 'prescriptions' && duplicateInn(plan.prescriptions).map((d) => ( /* D89: information, never «не приймайте» */
        <p key={d.inn} role="status" className="protocol-card rounded-2xl border border-line bg-surface p-3 text-sm">{P.duplicate(d.titles, d.inn)}</p>
      ))}
      {section === 'prescriptions' && <Block title={P.prescriptions} empty={P.emptyBy.prescriptions} onAdd={() => setEditing({ what: 'prescription' })}>
        {prescriptions.map((p) => ( /* D104: tests live with the next checkup */
          <Item key={p.id} onEdit={() => setEditing({ what: 'prescription', item: p })} piece={pieces?.get(p.id)}
            title={p.title} meta={[P.kinds[p.kind], (p.kind === 'medication' || p.kind === 'supplement') ? (p.med ? p.med.inn : P.offRegistry) : undefined, p.dose, p.asNeeded ? (prnLimit(p) ? `${t.conclusion.asNeeded}, ${prnLimitText(prnLimit(p)!)}` : t.conclusion.asNeeded) : p.schedule?.times.join(', '),
              p.schedule?.withFood === true ? P.withFood.toLowerCase() : p.schedule?.withFood === false ? t.conclusion.empty : undefined,
              p.until ? (p.until < todayISO() ? P.courseOver(dmy(p.until)) : P.courseUntil(dmy(p.until))) : undefined, // D103: the course end in the list
              p.dueDate ? `${P.dueDate.toLowerCase()} ${dmy(p.dueDate)}` : undefined,
              ...(entries && stockLeft(p, entries) ? [P.stockDays(stockLeft(p, entries)!.days)] : [])]} note={p.notes} source={p.source}
            warn={timesToSet(p) ? P.setTimes(timesToSet(p)!) : undefined} />
        ))}
      </Block>}

      {section === 'constraints' && <Block title={P.constraints} empty={P.emptyBy.constraints} onAdd={() => setEditing({ what: 'constraint' })}>
        {plan.constraints.map((c) => (
          <li key={c.id} className="flex items-start gap-2 border-t border-line px-3 py-2 first:border-t-0">
            <label className="flex min-h-tap min-w-tap items-center justify-center">
              <input type="checkbox" checked={c.active} aria-label={`${c.title}: ${c.active ? P.active : P.inactive}`}
                onChange={(e) => save({ constraints: plan.constraints.map((x) => (x.id === c.id ? { ...x, active: e.target.checked } : x)) })}
                className="protocol-switch" />
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
                      <input type="checkbox" checked={!c.off?.includes(r.id)} className="protocol-switch"
                        onChange={(e) => save({ constraints: plan.constraints.map((x) => (x.id === c.id
                          ? { ...x, off: e.target.checked ? (x.off ?? []).filter((o) => o !== r.id) : [...(x.off ?? []), r.id] } : x)) })} />
                      <span>{r.title}</span></label>
                  ))}
                  {(() => { const cov = dietCoverage({ constraints: [c] })[0]; return cov && ( /* R02: what the check really runs of this diet */
                    <p className={`text-xs ${cov.configured ? 'text-muted' : 'text-warn'}`}>{cov.configured ? t.diet.coverage(cov.active, cov.off, cov.unchecked) : t.diet.noRules}</p>); })()}
                  <p className="text-xs text-muted">{DIET_SOURCE}</p>
                </div>
              ); })()}
            </div>
            <EditButton label={c.title} onClick={() => setEditing({ what: 'constraint', item: c })} />
          </li>
        ))}
      </Block>}

      {/* D179: the rehabilitation complex — as the doctor gave it */}
      {section === 'constraints' && <Block title={t.rehab.planTitle} empty={t.rehab.planEmpty} addLabel={plan.rehab ? P.edit : t.rehab.add} onAdd={() => setEditing({ what: 'rehab' })}>
        {plan.rehab && <Item onEdit={() => setEditing({ what: 'rehab' })} title={t.rehab.title}
          meta={[t.rehab.now(currentStage(plan.rehab).title, plan.rehab.perDay)]} source={plan.rehab.source} />}
      </Block>}

      {/* D178: limits for training as a structure — the library and «Скласти тренування» show only what they allow */}
      {section === 'constraints' && <Block title={t.training.title} empty={t.training.empty} addLabel={t.training.add} onAdd={() => setEditing({ what: 'restriction' })}>
        {(plan.restrictions ?? []).map((r) => (
          <Item key={r.id} onEdit={() => setEditing({ what: 'restriction', item: r })} title={restrictionText(r)}
            meta={[r.active ? undefined : P.inactive, r.until && r.until < todayISO() ? t.training.ended : undefined]} source={r.source} />
        ))}
      </Block>}

      {section === 'goals' && <>
      <Block title={P.targets} onAdd={() => setEditing({ what: 'targets' })} addLabel={P.edit}>
        <li className="px-3 py-2">{targetSummary(tg) || <span className="text-muted">{P.emptyBy.targets}</span>}</li>
        {dietConflicts(plan).map((x) => ( /* D90: a doctor's target and a diet's norm that differ — a question, not settled */
          <li key={x.code + x.field} role="status" className="border-t border-line px-3 py-2 text-sm text-warn">
            {t.diet.conflict(x.code, t.diet.fields[x.field], x.target, x.range[0], x.range[1])}</li>
        ))}
      </Block>

      <Block title={P.modes} empty={P.emptyBy.modes} onAdd={() => setEditing({ what: 'mode' })}>
        {plan.modes.map((m) => (
          <Item key={m.id} onEdit={() => setEditing({ what: 'mode', item: m })} title={m.title}
            meta={[`${dmy(m.from)} — ${dmy(m.to)}`, targetSummary(m.targetsOverride) || undefined]} note={m.notes.join(' · ')} />
        ))}
      </Block>
      </>}

      {section === 'checkup' && <Block title={P.checkup} empty={P.emptyBy.checkup} onAdd={() => setEditing({ what: 'checkup' })} addLabel={plan.nextCheckup ? P.edit : P.add}>
        {plan.nextCheckup && <li className="px-3 py-2"><p className="font-medium">{dmy(plan.nextCheckup.date)}</p>
          <p className="text-sm text-muted">{plan.nextCheckup.tests.join(', ')}</p>
          {pieces?.get('checkup') && <Paper url={pieces.get('checkup')!} title={P.checkup} />}</li>}
        {plan.prescriptions.filter((p) => p.kind === 'test').map((p) => ( /* D104: tests to take, next to the visit — not among the medicines */
          <Item key={p.id} onEdit={() => setEditing({ what: 'prescription', item: p })} title={p.title} piece={pieces?.get(p.id)}
            meta={[P.kinds.test, p.dueDate ? `${P.dueDate.toLowerCase()} ${dmy(p.dueDate)}` : undefined]} note={p.notes} source={p.source} />
        ))}
      </Block>}

      <p className="pb-2 text-sm text-muted">{P.disclaimer}</p>

      {editing?.what === 'prescription' && <PrescriptionForm plan={plan} item={editing.item} onClose={() => setEditing(null)} />}
      {editing?.what === 'constraint' && <ConstraintForm plan={plan} item={editing.item} onClose={() => setEditing(null)} />}
      {editing?.what === 'mode' && <ModeForm plan={plan} item={editing.item} onClose={() => setEditing(null)} />}
      {editing?.what === 'rehab' && <RehabForm plan={plan} onClose={() => setEditing(null)} />}
      {editing?.what === 'restriction' && <RestrictionForm plan={plan} item={editing.item} onClose={() => setEditing(null)} />}
      {editing?.what === 'targets' && <TargetsForm plan={plan} onClose={() => setEditing(null)} />}
      {editing?.what === 'checkup' && <CheckupForm plan={plan} onClose={() => setEditing(null)} />}
    </section>
  );
}

function targetSummary(tg: Partial<Targets>): string {
  const ref = (f: keyof NonNullable<Targets['fromDiet']>) => (tg.fromDiet?.[f] ? ` (${t.diet.fromRef(tg.fromDiet[f]!)})` : ''); // R02
  const parts = [
    tg.kcal != null && `${tg.kcal} ккал${ref('kcal')}`, tg.proteinG != null && `білок ${tg.proteinG} г${ref('proteinG')}`,
    tg.carbsG?.min != null && `вуглеводи не менше ${tg.carbsG.min} г`, tg.carbsG?.max != null && `вуглеводи до ${tg.carbsG.max} г${ref('carbsG')}`,
    tg.fatG != null && `жири ${tg.fatG} г${ref('fatG')}`, tg.calciumMg != null && `кальцій ${tg.calciumMg} мг`, tg.waterMl != null && `вода ${tg.waterMl} мл${tg.waterFrom ? ' (орієнтир)' : ''}`, tg.waterMaxMl != null && `рідина до ${tg.waterMaxMl} мл`,
    tg.lastMealBy && `їжа до ${tg.lastMealBy}`, tg.weightGoalKg != null && `вага ${tg.weightGoalKg} кг`,
    tg.maxWeightLossKgPerWeek != null && `не швидше ${tg.maxWeightLossKgPerWeek} кг/тиждень`,
  ];
  return parts.filter(Boolean).join(' · ');
}

// ------------------------------------------------------------------ layout pieces
function Block({ title, onAdd, addLabel = P.add, empty = P.empty, children }: { title: string; onAdd: () => void; addLabel?: string; empty?: string; children: ReactNode }) {
  const list = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section className="overflow-hidden protocol-card rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-1">
        <h2 className="min-w-0 font-semibold">{title}</h2>
        <button type="button" onClick={onAdd} className="flex min-h-tap shrink-0 items-center gap-1 px-2 text-accent">
          {addLabel === P.add && <Plus size={18} aria-hidden />}{addLabel}</button>
      </div>
      {list.length ? <ul>{children}</ul> : <p className="px-3 py-3 text-muted">{empty}</p>}
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
  const { enabled } = useFeatures();
  const [p, setP] = useState<Prescription>(item ?? { id: newId(), kind: 'medication', title: '', source: '', ...sinceNow() }); // D97, D103
  const [times, setTimes] = useState(item?.schedule?.times.join(', ') ?? '');
  const entries = useAllEntries();
  const now = item && entries ? stockLeft(item, entries) : undefined;
  const [left, setLeft] = useState(now ? String(now.left) : ''); // D69: what is in the pack now
  const [perDose, setPerDose] = useState(String(item?.stock?.perDose ?? 1));
  const drug = p.kind === 'medication' || p.kind === 'supplement';
  const index = useMedIndex(drug); // D89: the register on the device — names only, never a dose
  const suggestions = useMemo(() => (index && drug && !p.med ? searchMeds(index, p.title, 5) : []), [index, drug, p.med, p.title]);
  const parsedTimes = readTimes(times, { allowShortHour: true });
  const asNeeded = drug && p.asNeeded;
  const timeError = !asNeeded && times.trim() && !parsedTimes ? P.invalidTimes : undefined;
  const onSave = () => {
    const ts = asNeeded ? [] : parsedTimes ?? [];
    const n = Number(left.replace(',', '.')), per = Number(perDose.replace(',', '.')) || 1;
    const counted = left.trim() === '' ? undefined : String(n) === String(now?.left) && per === item?.stock?.perDose ? item.stock
      : { left: n, perDose: per, at: atLocal(todayISO(), format(new Date(), 'HH:mm')) };
    const { stock: _s, ...rest } = p;
    const next: Prescription = { ...rest, title: p.title.trim(), ...(ts.length || asNeeded && p.schedule?.withFood != null
      ? { schedule: { times: ts, withFood: p.schedule?.withFood ?? false } } : { schedule: undefined }),
      ...(counted && n >= 0 ? { stock: counted } : {}) };
    if (item) void photoEdited(item.id, [item.title, item.dose, item.schedule?.times, item.schedule?.withFood, item.asNeeded, item.until, prnLimit(item)],
      [next.title, next.dose, next.schedule?.times, next.schedule?.withFood, next.asNeeded, next.until, prnLimit(next)]);
    return save({ prescriptions: upsert(plan.prescriptions, next) });
  };
  return (
    <FormSheet title={item ? P.edit : P.prescriptions} onClose={onClose} onSave={onSave}
      blocked={drug && p.title.trim() ? (!p.dose?.trim() ? P.needDose : !times.trim() && !asNeeded ? P.needTime : timeError) : timeError}
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
      {enabled && p.kind === 'lifestyle' && <Field label={t.startFlow.activity}><select value={p.activity ?? ''} onChange={(e) => setP({ ...p, activity: (e.target.value || undefined) as Prescription['activity'] })} className={field}>
        <option value="">{t.startFlow.noActivity}</option>{ACTIVITY_KINDS.map((kind) => <option key={kind} value={kind}>{t.startFlow.activityKinds[kind]}</option>)}
      </select><span className="text-xs text-muted">{t.startFlow.activityHint}</span></Field>}
      <Field label={P.dose}><input value={p.dose ?? ''} onChange={(e) => setP({ ...p, dose: e.target.value || undefined })} className={field} /></Field>
      {drug && <p className={`-mt-2 text-xs ${p.dose?.trim() ? 'text-muted' : 'text-warn'}`}>{p.dose?.trim() ? P.medDoseNote : P.noDose}</p>}
      <Field label={P.times}><input value={times} onChange={(e) => setTimes(e.target.value)} placeholder={P.timesPh} className={field}
        aria-invalid={!!timeError} aria-describedby={timeError ? 'prescription-times-error' : undefined} /></Field>
      {timeError && <p id="prescription-times-error" className="-mt-2 text-sm text-warn">{timeError}</p>}
      {drug && (
        <label className="protocol-toggle-row -mt-1 min-h-tap">
          <input type="checkbox" checked={!!p.asNeeded} onChange={(e) => { const { asNeeded: _a, ...rest } = p; setP(e.target.checked ? { ...p, asNeeded: true } : rest); }}
            className="protocol-switch" /><span>{P.asNeeded}</span></label>
      )}
      {drug && p.asNeeded && <LimitFields p={p} setP={setP} /> /* D118, R01 */}
      {drug && (
        <Field label={P.until}><input type="date" value={p.until ?? ''} min={p.since} onChange={(e) => { const { until: _u, ...rest } = p; setP(e.target.value ? { ...p, until: e.target.value } : rest); }} className={field} /></Field>
      )}
      <label className="protocol-toggle-row min-h-tap">
        <input type="checkbox" checked={p.schedule?.withFood ?? false} className="protocol-switch"
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

/** R01: the doctor's daily limit — a number and its unit; an old number-only limit shows as «unit not known» until one is set. */
function LimitFields({ p, setP }: { p: Prescription; setP: (p: Prescription) => void }) {
  const l = prnLimit(p);
  const set = (value: number, unit: DailyLimit['unit']) => {
    const { maxPerDay: _m, limit: _l, ...rest } = p;
    setP(value > 0 ? { ...rest, limit: { value, unit, sourceText: l?.sourceText ?? '', source: l && l.source !== 'legacy' && l.value === value && l.unit === unit ? l.source : 'plan' } } : rest);
  };
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Field label={t.prn.planLimit}><input inputMode="decimal" value={l ? String(l.value).replace('.', ',') : ''} className={field}
          onChange={(e) => set(Number(e.target.value.replace(',', '.')), l?.unit ?? 'unknown')} /></Field>
        <Field label={t.prn.planUnit}><select value={l?.unit ?? 'unknown'} disabled={!l} onChange={(e) => l && set(l.value, e.target.value as DailyLimit['unit'])} className={field}>
          {[...LIMIT_UNITS, 'unknown' as const].map((u) => <option key={u} value={u}>{t.prn.unitNames[u]}</option>)}</select></Field>
      </div>
      {l?.sourceText && <p className="text-xs text-muted">«{l.sourceText}»</p>}
      <p className={`text-xs ${l?.unit === 'unknown' ? 'text-warn' : 'text-muted'}`}>{l?.unit === 'unknown' ? t.prn.legacy : t.prn.planUnitHint}</p>
    </div>
  );
}

function ConstraintForm({ plan, item, onClose }: { plan: PlanRow; item?: Constraint; onClose: () => void }) {
  const [c, setC] = useState<Constraint>(item ?? { id: newId(), tag: 'custom', title: '', reason: '', source: '', active: true });
  const [fill, setFill] = useState(false); // D90: the diet's norms into empty targets — only when asked
  const d = c.tag === 'diet' ? dietOf(c.diet) : undefined;
  return (
    <FormSheet title={item ? P.edit : P.constraints} onClose={onClose}
      onSave={() => { if (item) void photoEdited(item.id, [item.tag, item.title, item.allergens, item.diet], [c.tag, c.title.trim(), c.allergens, c.diet]); return save({ constraints: upsert(plan.constraints, { ...c, title: c.title.trim()
        || (c.tag === 'allergy' && c.allergens?.length ? P.allergyTitle(c.allergens.map((a) => t.allergen.name[a]).join(', ')) : P.tags[c.tag]) }),
        ...(d && fill ? { targets: fillEmptyTargets(plan.targets, d) } : {}) }); }}
      onDelete={item ? () => save({ constraints: plan.constraints.filter((x) => x.id !== item.id) }) : undefined}>
      <Field label={P.tag}>
        <select value={c.tag} onChange={(e) => setC({ ...c, tag: e.target.value as ConstraintTag })} className={field}>
          {TAGS.map((tag) => <option key={tag} value={tag}>{P.tags[tag]}</option>)}</select></Field>
      {c.tag === 'allergy' && <AllergenPicker legend={P.allergyPick} value={c.allergens ?? []} onChange={(v) => setC({ ...c, allergens: v })} />}
      {c.tag === 'diet' && <DietPicker value={c.diet} fill={fill} onFill={setFill} targets={plan.targets}
        onPick={(x) => setC({ ...c, diet: x.code, title: `${x.code} — ${x.name}`, source: c.source || 'Наказ МОЗ №931' })} />}
      <Field label={P.title_}><input value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} placeholder={P.tags[c.tag]} className={field} /></Field>
      <Field label={P.reason}><textarea value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value })} rows={2} className={`${field} py-2`} /></Field>
      <Field label={P.source}><input value={c.source} onChange={(e) => setC({ ...c, source: e.target.value })} placeholder="Уролог, 2025" className={field} /></Field>
      <label className="protocol-toggle-row min-h-tap">
        <input type="checkbox" checked={c.active} onChange={(e) => setC({ ...c, active: e.target.checked })} className="protocol-switch" />
        <span>{P.active}</span></label>
    </FormSheet>
  );
}

export function TargetFields({ value, onChange }: { value: Partial<Targets>; onChange: (v: Partial<Targets>) => void }) {
  const T = P.target;
  const n = (key: 'kcal' | 'proteinG' | 'fatG' | 'calciumMg' | 'waterMl' | 'waterMaxMl' | 'weightGoalKg' | 'maxWeightLossKgPerWeek') => (
    <Field label={T[key]}><input inputMode="decimal" value={str(value[key])} className={field}
      onChange={(e) => { const next = { ...value, [key]: num(e.target.value) }; if (key === 'waterMl') delete next.waterFrom; onChange(next); /* D169: typed in — no longer the reference */ }} /></Field>
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
      {n('fatG')}{n('calciumMg')}{n('waterMl')}{n('waterMaxMl')}
      <Field label={T.lastMealBy}><input type="time" value={value.lastMealBy ?? ''} onChange={(e) => onChange({ ...value, lastMealBy: e.target.value || undefined })} className={field} /></Field>
      {n('weightGoalKg')}{n('maxWeightLossKgPerWeek')}
    </div>
  );
}

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !Number.isNaN(v))) as T;

function TargetsForm({ plan, onClose }: { plan: PlanRow; onClose: () => void }) {
  const [tg, setTg] = useState<Partial<Targets>>(plan.targets);
  return (
    <FormSheet title={P.targets} onClose={onClose} onSave={() => save({ targets: ownTargets(plan.targets, clean(tg)) })}>
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

/** D179: the complex as text (one format with the clinic cabinet and a photo's draft); the stage being done stays when it is
 *  still there, else the first. Saving never moves a stage on. */
function RehabForm({ plan, onClose }: { plan: PlanRow; onClose: () => void }) {
  const R = t.rehab;
  const [text, setText] = useState(plan.rehab ? rehabText(plan.rehab.stages) : '');
  const [perDay, setPerDay] = useState(plan.rehab?.perDay ?? 1), [source, setSource] = useState(plan.rehab?.source ?? '');
  const stages = useMemo(() => readRehab(text), [text]);
  const onSave = () => {
    // the stage being done keeps its place (by order — titles may be reworded); an edit never moves it on
    const old = plan.rehab, at = old ? Math.max(0, old.stages.findIndex((s) => s.id === old.stageId)) : 0;
    return save({ rehab: { id: old?.id ?? newId(), perDay: Math.min(10, Math.max(1, perDay)), stages, stageId: stages[Math.min(at, stages.length - 1)]!.id, source: source.trim() } });
  };
  return (
    <FormSheet title={R.planTitle} onClose={onClose} onSave={onSave} blocked={stages.length ? undefined : R.needText}
      onDelete={plan.rehab ? () => save({ rehab: undefined }) : undefined}>
      <Field label={R.text}><textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={R.textPh} className={`${field} py-2`} /></Field>
      <p className="text-sm text-muted">{R.textHint}</p>
      {stages.length > 0 && <p className="text-sm" data-testid="rehab-read">{stages.map((s) => `${s.title}: ${s.exercises.length}`).join(' · ')}</p>}
      <Field label={R.perDay}><input type="number" inputMode="numeric" min={1} max={10} value={perDay} onChange={(e) => setPerDay(Math.round(Number(e.target.value) || 1))} className={field} /></Field>
      <Field label={R.source_}><input value={source} onChange={(e) => setSource(e.target.value)} placeholder={R.sourcePh} className={field} /></Field>
    </FormSheet>
  );
}

/** D178: one limit for training, as the doctor said it — what, which part, how much, until when, who. */
function RestrictionForm({ plan, item, onClose }: { plan: PlanRow; item?: Restriction; onClose: () => void }) {
  const T = t.training;
  const [r, setR] = useState<Restriction>(item ?? { id: newId(), kind: 'no-weight-bearing', part: 'left-leg', source: '', active: true });
  const needsPart = r.kind === 'no-weight-bearing' || r.kind === 'no-load', needsValue = r.kind === 'max-kg' || r.kind === 'max-pulse';
  const onSave = () => {
    const clean: Restriction = { id: r.id, kind: r.kind, source: r.source.trim(), active: r.active,
      ...(r.kind !== 'max-pulse' && r.part ? { part: r.part } : {}), ...(needsValue && r.value ? { value: r.value } : {}), ...(r.until ? { until: r.until } : {}) };
    return save({ restrictions: upsert(plan.restrictions ?? [], clean) });
  };
  return (
    <FormSheet title={item ? P.edit : T.add} onClose={onClose} onSave={onSave} blocked={needsPart && !r.part ? T.needPart : needsValue && !(r.value && r.value > 0) ? T.needValue : undefined}
      onDelete={item ? () => save({ restrictions: (plan.restrictions ?? []).filter((x) => x.id !== item.id) }) : undefined}>
      <Field label={T.kind}><select value={r.kind} onChange={(e) => setR({ ...r, kind: e.target.value as RestrictionKind })} className={field}>
        {Object.entries(T.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      {r.kind !== 'max-pulse' && <Field label={T.part}><select value={r.part ?? ''} onChange={(e) => setR({ ...r, part: (e.target.value || undefined) as BodyPart | undefined })} className={field}>
        {!needsPart && <option value="">{T.noPart}</option>}
        {BODY_PARTS.map((p) => <option key={p} value={p}>{T.parts[p]}</option>)}</select></Field>}
      {needsValue && <Field label={T.value}><input type="number" inputMode="numeric" min={1} required value={r.value ?? ''}
        onChange={(e) => setR({ ...r, value: e.target.value === '' ? undefined : Math.max(1, Math.round(Number(e.target.value))) })} className={field} /></Field>}
      <Field label={T.until}><input type="date" value={r.until ?? ''} onChange={(e) => setR({ ...r, until: e.target.value || undefined })} className={field} /></Field>
      <p className="text-sm text-muted">{T.untilHint}</p>
      <Field label={T.source}><input value={r.source} onChange={(e) => setR({ ...r, source: e.target.value })} placeholder={T.sourceHint} className={field} /></Field>
      <label className="flex min-h-tap items-center gap-2"><input type="checkbox" className="protocol-switch" checked={r.active} onChange={(e) => setR({ ...r, active: e.target.checked })} />{P.active}</label>
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

function ClinicActivate({ title, onActivate }: { title: string; onActivate: () => Promise<void> }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  return <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
    <label className="flex min-h-tap items-start gap-3">
      <input type="checkbox" className="mt-1 h-5 w-5" checked={checked} onChange={e => setChecked(e.target.checked)} />
      <span>Я звірив(ла) цей план із призначенням лікаря: {title}</span>
    </label>
    <p className="text-muted">Після підтвердження призначення потраплять у ваш план без часу прийому. Час і тривалість ви вкажете самі.</p>
    <button type="button" disabled={!checked || busy} className="min-h-tap rounded-xl bg-accent px-4 text-white disabled:opacity-50"
      onClick={async () => { setBusy(true); try { await onActivate(); } finally { setBusy(false); } }}>Додати до мого плану</button>
  </div>;
}
