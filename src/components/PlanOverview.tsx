import { CalendarDays, ArrowRight, ChevronRight, ClipboardList, FilePlus2, History, Pill, Shield, ShieldCheck, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { t } from '../i18n/uk';

type PlanOverviewProps = {
  prescriptions: number;
  constraints: number;
  goals: number;
  checkups: number;
  prescriptionsPreview: string;
  constraintsPreview: string;
  goalsPreview: string;
  checkupPreview: string;
};

/** Protocol 2.0: a calm, read-only overview. Editing remains in existing dedicated routes. */
export function PlanOverview({ prescriptions, constraints, goals, checkups, prescriptionsPreview, constraintsPreview, goalsPreview, checkupPreview }: PlanOverviewProps) {
  const sections = [
    { path: '/plan/prescriptions', title: t.plan.prescriptions, count: prescriptions, preview: prescriptionsPreview, Icon: Pill },
    { path: '/plan/constraints', title: t.plan.constraints, count: constraints, preview: constraintsPreview, Icon: Shield },
    { path: '/plan/goals', title: `${t.plan.targets} й ${t.plan.modes.toLowerCase()}`, count: goals, preview: goalsPreview, Icon: Target },
    { path: '/plan/checkup', title: t.plan.checkup, count: checkups, preview: checkupPreview, Icon: CalendarDays },
  ];
  return (
    <div className="space-y-4">
      <div className="protocol-card p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent">
          <ShieldCheck size={16} aria-hidden /> Ваш план
        </div>
        <h2 className="text-xl font-semibold">Призначення — під вашим контролем</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Перевіряйте рекомендації лікаря, терміни та обмеження. Щоденні відмітки залишаються у розділі «Сьогодні».
        </p>
        <Link to="/plan/scan" className="protocol-action mt-4 flex justify-between">
          <span className="inline-flex items-center gap-2"><FilePlus2 size={20} aria-hidden />{t.conclusion.button}</span>
          <ArrowRight size={20} aria-hidden />
        </Link>
      </div>
      <nav aria-label={t.plan.sections}>
        <div className="mb-2 flex items-center gap-2">
          <ClipboardList size={18} className="text-accent" aria-hidden />
          <h2 className="font-semibold">Склад плану</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {sections.map(({ path, title, count, preview, Icon }) => (
            <Link key={path} to={path} className="flex min-h-[5rem] items-center gap-3 protocol-card rounded-2xl border border-line bg-surface p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Icon size={20} aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{title}</span>
                <span className="mt-1 block text-sm text-muted">{count ? t.plan.itemsCount(count) : t.plan.empty}</span>
                {preview && <span className="line-clamp-2 block text-sm text-muted">{preview}</span>}
              </span>
              <ChevronRight size={18} className="shrink-0 text-accent" aria-hidden />
            </Link>
          ))}
        </div>
      </nav>
      <Link to="/plan/history" className="flex min-h-tap items-center justify-between protocol-card rounded-2xl border border-line bg-surface px-4 py-3">
        <span className="inline-flex items-center gap-2 font-medium"><History size={19} aria-hidden />{t.versions.open}</span>
        <ArrowRight size={18} className="text-muted" aria-hidden />
      </Link>
    </div>
  );
}
