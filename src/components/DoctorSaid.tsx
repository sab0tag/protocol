// D165: «Мій план» as «Що сказав лікар» — who and when, the medicines, the food, what comes next, in plain words. A row
// opens its part of the plan to correct it; the paper the line was read from opens under it (D114). Nothing here edits.
import { ChevronRight, History } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { todayISO } from '../domain/dates';
import { constraintWords, medicineWords, whoWords } from '../domain/planWords';
import { untilVisit } from '../domain/results';
import type { Plan } from '../domain/types';
import { t } from '../i18n/uk';
import { DoctorQuestions } from './DoctorQuestions';

const L = t.said;
const dmy = (d: string) => d.split('-').reverse().join('.');

export function DoctorSaid({ plan, pieces, goals }: { plan: Plan; pieces?: Map<string, string>; goals: string }) {
  const today = todayISO();
  const meds = plan.prescriptions.filter((p) => p.kind !== 'test');
  const tests = plan.prescriptions.filter((p) => p.kind === 'test');
  const limits = plan.constraints.filter((c) => c.active);
  const who = whoWords([...plan.prescriptions.map((p) => p.source), ...plan.constraints.map((c) => c.source)]);
  const history = <Link to="/plan/history" className="flex min-h-tap items-center gap-2 px-1 text-sm font-medium text-accent">
    <History size={18} aria-hidden />{t.versions.open}</Link>;
  if (!meds.length && !limits.length && !tests.length && !plan.nextCheckup && !goals) return <div className="space-y-3"><p className="protocol-card p-4">{L.empty}</p><DoctorQuestions plan={plan} />{history}</div>;
  const visit = plan.nextCheckup;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted"><span className="font-semibold text-ink">{L.who}: </span>{who ?? L.noWho}</p>
      <Part title={L.meds} to="/plan/prescriptions">
        {meds.length ? meds.map((p) => { const w = medicineWords(p, today); return (
          <Row key={p.id} to="/plan/prescriptions" piece={pieces?.get(p.id)} title={w.name}>{w.how}</Row>); })
          : <li className="px-3 py-3 text-muted">{L.noMeds}</li>}
      </Part>
      <Part title={L.food} to="/plan/constraints">
        {limits.length ? limits.map((c) => <Row key={c.id} to="/plan/constraints" piece={pieces?.get(c.id)} title={constraintWords(c)} />)
          : <li className="px-3 py-3 text-muted">{L.noFood}</li>}
        {goals && <Row to="/plan/goals" title={L.goals}>{goals}</Row>}
      </Part>
      <Part title={L.next} to="/plan/checkup">
        <Row to="/plan/checkup" piece={pieces?.get('checkup')} title={visit ? L.visit(dmy(visit.date), untilVisit(visit.date, today)) : L.noVisit}>
          {visit?.tests.length ? visit.tests.join(', ') : undefined}</Row>
        {tests.map((p) => <Row key={p.id} to="/plan/checkup" piece={pieces?.get(p.id)} title={p.title}>{p.dueDate ? `до ${dmy(p.dueDate)}` : L.tests}</Row>)}
      </Part>
      <DoctorQuestions plan={plan} />{/* D191 */}
      {history}
    </div>
  );
}

function Part({ title, to, children }: { title: string; to: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="protocol-card overflow-hidden p-0">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Link to={to} className="flex min-h-tap items-center px-2 text-sm text-accent">{L.change}</Link>
      </div>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

function Row({ to, title, piece, children }: { to: string; title: string; piece?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-2">
      <Link to={to} className="flex min-h-tap items-center gap-2">
        <span className="min-w-0 flex-1"><span className="block font-semibold">{title}</span>
          {children && <span className="block text-sm text-muted">{children}</span>}</span>
        <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
      </Link>
      {piece && <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-[2rem] text-sm text-accent underline">{open ? L.paperHide : L.paper}</button>}
      {piece && open && <img src={piece} alt={`${L.paper}: ${title}`} className="mt-1 max-h-32 max-w-full rounded border border-line" />}
    </li>
  );
}
