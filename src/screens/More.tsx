import { Eye, ListChecks, Info, Activity, BellRing, ChevronRight, Dumbbell, RefreshCw, Salad, Sparkles, UserRound, MessageSquareWarning, Zap, MessageCircle, HandHeart, Database, Settings2, Apple, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { enterDemo, inDemo } from '../data/db';
import { t } from '../i18n/uk';
import { MORE_ROUTES, ROUTES, SETTINGS_PATH, type MoreRouteId, type SettingsRouteId } from '../app/navigation';
import { useFeatures } from '../app/features';

const LINKS = {
  assistant: { Icon: MessageCircle, title: t.assistant.title },
  menu: { Icon: Sparkles, title: t.menu.quick },
  wellbeing: { Icon: Activity, title: t.well.title },
  workout: { Icon: Dumbbell, title: t.workout.title },
  dishes: { Icon: Salad, title: t.dishes.title },
  foods: { Icon: Apple, title: t.dishes.foods },
  profiles: { Icon: UserRound, title: t.profiles.title },
  frictions: { Icon: MessageSquareWarning, title: t.friction.title },
  pilot: { Icon: HandHeart, title: t.pilot.title },
  conciergeLog: { Icon: Sparkles, title: t.conciergeLog.link },
  about: { Icon: Info, title: t.about.link },
  reminders: { Icon: BellRing, title: t.remind.title },
  sync: { Icon: RefreshCw, title: t.sync.title },
  data: { Icon: Database, title: t.data.title },
  modules: { Icon: Settings2, title: t.modules.title },
  quickLinks: { Icon: Zap, title: t.quick.title },
  myDay: { Icon: ListChecks, title: t.myday.title },
  onboarding: { Icon: UserRound, title: t.welcome.again },
} satisfies Record<MoreRouteId | SettingsRouteId, { Icon: LucideIcon; title: string }>;

export type MoreLink = { to: string; Icon: LucideIcon; title: string; hint: string };

/** D137: a switched-off module's rows leave «Ще». Without the rollout flag «Що показувати» stays hidden — the previous
 *  build's access is unchanged. */
export function useMoreLinks(routes: readonly (MoreRouteId | SettingsRouteId)[]): MoreLink[] {
  const { can, enabled } = useFeatures();
  return routes.filter((id) => can(ROUTES[id].feature) && (enabled || id !== 'modules'))
    .map((id) => ({ to: ROUTES[id].path, ...LINKS[id], hint: t.more.links[id] })); // D154
}

/** One list of links: the name, and in a line what is inside (D154). */
export function LinkList({ links }: { links: MoreLink[] }) {
  return <ul className="divide-y divide-line overflow-hidden protocol-card rounded-2xl border border-line bg-surface">
    {links.map(({ to, Icon, title, hint }) => {
      const id = `more-hint-${to.replace(/\W/g, '')}`;
      return <li key={to}>
        <Link to={to} aria-label={title} aria-describedby={id} className="flex min-h-tap items-center gap-3 px-4 py-3">
          <Icon size={20} className="shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block font-medium">{title}</span>
            <span id={id} className="block text-sm text-muted">{hint}</span></span>
          <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
        </Link>
      </li>;
    })}
  </ul>;
}

/** ТЗ 17.11, step 2: «Ще» is one list without categories; settings are its first row. */
export function More() {
  const links = useMoreLinks(MORE_ROUTES);
  return (
    <section className="space-y-4 pt-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t.more.title}</h1>
      <LinkList links={[{ to: SETTINGS_PATH, Icon: Settings2, title: t.more.settings, hint: t.more.settingsHint }, ...links]} />
      {!inDemo() && <ExampleEntry />}
      {/* D168: the staff's way in — quiet, under the list, not one of the person's sections */}
      <p className="pt-2 text-center"><Link to="/clinic" className="inline-flex min-h-tap items-center px-2 text-sm text-muted underline underline-offset-4">{t.more.clinic}</Link></p>
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
        <button type="button" onClick={enterDemo} className="min-h-tap rounded-xl bg-accent px-3 font-medium text-on-accent">{t.example.confirmYes}</button>
        <button type="button" onClick={() => setAsking(false)} className="min-h-tap rounded-xl border border-line px-3">{t.example.confirmNo}</button>
      </div>
    </div>
  ) : (
    <button type="button" onClick={() => setAsking(true)} className="mb-4 flex min-h-tap w-full items-center gap-3 protocol-card rounded-2xl border border-line bg-surface px-3 py-2 text-left">
      <Eye size={20} className="text-accent" aria-hidden /><span className="flex-1"><span className="block font-medium">{t.welcome.example}</span>
        <span className="block text-sm text-muted">{t.example.safe}</span></span></button>
  );
}
