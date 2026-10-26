import { SceneHeader } from '../components/SceneHeader';
import { Eye, Info, Activity, BellRing, ChevronRight, Dumbbell, FileText, RefreshCw, Salad, ShoppingCart, Sparkles, UserRound, CalendarRange, MessageSquareWarning, Zap, MessageCircle, HandHeart, Database, Heart, ClipboardPlus, Lightbulb, Settings2, Apple, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { enterDemo, inDemo } from '../data/db';
import { t } from '../i18n/uk';
import { MORE_ROUTE_GROUPS, ROUTES, type MoreGroupId, type MoreRouteId } from '../app/navigation';

const LINKS = {
  assistant: { Icon: MessageCircle, title: t.assistant.title },
  menu: { Icon: Sparkles, title: t.menu.quick },
  shopping: { Icon: ShoppingCart, title: t.shop.title },
  dishes: { Icon: Salad, title: t.dishes.title },
  foods: { Icon: Apple, title: t.dishes.foods },
  wellbeing: { Icon: Activity, title: t.well.title },
  wellbeingJournal: { Icon: Heart, title: t.well.journal },
  progressLabs: { Icon: ClipboardPlus, title: t.progress.labs },
  progressMotivation: { Icon: Heart, title: t.progress.motivationTitle },
  progressInsights: { Icon: Lightbulb, title: t.progress.insightsTitle },
  workout: { Icon: Dumbbell, title: t.workout.title },
  week: { Icon: CalendarRange, title: t.week.title },
  report: { Icon: FileText, title: t.report.title },
  reminders: { Icon: BellRing, title: t.remind.title },
  sync: { Icon: RefreshCw, title: t.sync.title },
  quickLinks: { Icon: Zap, title: t.quick.title },
  data: { Icon: Database, title: t.data.title },
  frictions: { Icon: MessageSquareWarning, title: t.friction.title },
  pilot: { Icon: HandHeart, title: t.pilot.title },
  onboarding: { Icon: UserRound, title: t.welcome.again },
  conciergeLog: { Icon: Sparkles, title: t.conciergeLog.link },
  about: { Icon: Info, title: t.about.link },
} satisfies Record<MoreRouteId, { Icon: LucideIcon; title: string }>;

const GROUP_META = {
  food: { title: t.more.food, hint: t.more.foodHint, Icon: Salad },
  health: { title: t.more.health, hint: t.more.healthHint, Icon: Activity },
  settings: { title: t.more.settings, hint: t.more.settingsHint, Icon: Settings2 },
  app: { title: t.more.app, hint: t.more.appHint, Icon: Info },
} satisfies Record<MoreGroupId, { title: string; hint: string; Icon: LucideIcon }>;

export const MORE_GROUPS = MORE_ROUTE_GROUPS.map(({ id, routes }) => ({
  id,
  ...GROUP_META[id],
  links: routes.map((routeId) => ({ to: ROUTES[routeId].path, ...LINKS[routeId] })),
}));

export function More() {
  return (
    <section className="space-y-4 pt-4">
      <SceneHeader title={t.nav.more} description={t.visual.moreHint} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {MORE_GROUPS.map(({ id, title, hint, Icon }) => (
          <li key={id}>
            <Link to={`/more/${id}`} className="flex min-h-[4.5rem] items-center gap-3 protocol-card rounded-2xl border border-line bg-surface px-3 py-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <Icon size={22} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{title}</span>
                <span className="block text-sm text-muted">{hint}</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {!inDemo() && <ExampleEntry />}
      <p className="mt-4 text-sm text-muted">{t.plan.disclaimer}</p>
    </section>
  );
}

/** D98–D99: the example, one tap away — but asked first: from «Ще» the person has their own data, and must know it stays. */
function ExampleEntry() {
  const [asking, setAsking] = useState(false);
  return asking ? (
    <div role="alertdialog" aria-label={t.welcome.example} className="mb-4 space-y-2 rounded-2xl border border-accent/40 bg-surface p-3 text-sm">
      <p>{t.example.confirm}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={enterDemo} className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{t.example.confirmYes}</button>
        <button type="button" onClick={() => setAsking(false)} className="min-h-tap rounded-xl border border-line px-3">{t.example.confirmNo}</button>
      </div>
    </div>
  ) : (
    <button type="button" onClick={() => setAsking(true)} className="mb-4 flex min-h-tap w-full items-center gap-3 protocol-card rounded-2xl border border-line bg-surface px-3 py-2 text-left">
      <Eye size={20} className="text-accent" aria-hidden /><span className="flex-1"><span className="block font-medium">{t.welcome.example}</span>
        <span className="block text-sm text-muted">{t.example.safe}</span></span></button>
  );
}
