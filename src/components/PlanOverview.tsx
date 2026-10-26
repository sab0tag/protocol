import { ArrowRight, ClipboardList, FilePlus2, History, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { t } from '../i18n/uk';

type PlanOverviewProps = {
  prescriptions: number;
  constraints: number;
  goals: number;
  checkups: number;
};

/** Protocol 2.0: a calm, read-only overview. Editing remains in existing dedicated routes. */
export function PlanOverview({ prescriptions, constraints, goals, checkups }: PlanOverviewProps) {
  const sections = [
    { path: '/plan/prescriptions', title: t.plan.prescriptions, count: prescriptions },
    { path: '/plan/constraints', title: t.plan.constraints, count: constraints },
    { path: '/plan/goals', title: `${t.plan.targets} й ${t.plan.modes.toLowerCase()}`, count: goals },
    { path: '/plan/checkup', title: t.plan.checkup, count: checkups },
  ];
  return (
    <div className="space-y-4">
      <div className="protocol-scene-header relative overflow-hidden rounded-[1.75rem] p-5 text-white">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-200">
          <ShieldCheck size={16} aria-hidden /> Ваш план
        </div>
        <h2 className="text-xl font-semibold">Призначення — під вашим контролем</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/80">
          Перевіряйте рекомендації лікаря, терміни та обмеження. Щоденні відмітки залишаються у розділі «Сьогодні».
        </p>
        <Link to="/plan/scan" className="mt-4 flex min-h-tap items-center justify-between rounded-2xl bg-accent px-4 font-semibold text-surface">
          <span className="inline-flex items-center gap-2"><FilePlus2 size={20} aria-hidden />{t.conclusion.button}</span>
          <ArrowRight size={20} aria-hidden />
        </Link>
      </div>
      <section aria-label={t.plan.sections}>
        <div className="mb-2 flex items-center gap-2">
          <ClipboardList size={18} className="text-accent" aria-hidden />
          <h2 className="font-semibold">Склад плану</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {sections.map(({ path, title, count }) => (
            <Link key={path} to={path} className="flex min-h-[5rem] items-center justify-between gap-3 protocol-card rounded-2xl border border-line bg-surface p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <span><span className="block font-semibold">{title}</span><span className="mt-1 block text-sm text-muted">{count ? t.plan.itemsCount(count) : t.plan.empty}</span></span>
              <ArrowRight size={18} className="shrink-0 text-accent" aria-hidden />
            </Link>
          ))}
        </div>
      </section>
      <Link to="/plan/history" className="flex min-h-tap items-center justify-between protocol-card rounded-2xl border border-line bg-surface px-4 py-3">
        <span className="inline-flex items-center gap-2 font-medium"><History size={19} aria-hidden />{t.versions.open}</span>
        <ArrowRight size={18} className="text-muted" aria-hidden />
      </Link>
    </div>
  );
}
