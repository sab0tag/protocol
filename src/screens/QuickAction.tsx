// D66: records from a link — `#/do/water`, `#/do/med`, `#/do/symptom`, `#/do/meal` — for a phone's Back Tap, Shortcuts
// or a home-screen bookmark: one tap, the record is made, «День» opens with «Скасувати». A dose whose window has passed
// is not marked from a link — «День» asks when (D52). Each opening acts once, even if the page re-renders.
import { differenceInMinutes, format } from 'date-fns';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { saved, toast } from '../components/Toast';
import { db } from '../data/db';
import { buildChecklist } from '../domain/checklist';
import { atLocal, newId, todayISO } from '../domain/dates';
import { NOW_AFTER_MIN } from '../domain/reminders';
import type { DayEntry } from '../domain/types';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';
import { useFeatures } from '../app/features';
import { QUICK_ACTION_FEATURES } from '../app/navigation';
import { FeatureUnavailable } from '../components/FeatureUnavailable';
import { can } from '../domain/features';
import { modulePreferences } from '../domain/modulePreferences';
import { MODULE_POLICY_ENABLED } from '../domain/rollout';

export function QuickAction() {
  const { action } = useParams();
  const { can } = useFeatures();
  const location = useLocation();
  const feature = action && Object.hasOwn(QUICK_ACTION_FEATURES, action) ? QUICK_ACTION_FEATURES[action as keyof typeof QUICK_ACTION_FEATURES] : undefined;
  return feature && !can(feature) ? <FeatureUnavailable feature={feature} /> : <ActiveQuickAction key={`${action}:${location.key}`} />;
}

function ActiveQuickAction() {
  const { action } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const acted = useRef(false); // once per opening; a link typed into the bar has no history key of its own
  useEffect(() => {
    if (acted.current) return;
    acted.current = true;
    const ml = Math.min(1000, Math.max(50, Number(new URLSearchParams(location.search).get('ml')) || 250));
    void run(action ?? '', ml).then((to) => navigate(to, { replace: true }));
  }, [action, location.search, navigate]);
  return <p role="status" className="mt-10 text-center text-muted">{t.quick.working}</p>;
}

async function run(action: string, ml: number): Promise<string> {
  const events = MODULE_POLICY_ENABLED ? await db.moduleEvents.toArray() : [];
  const feature = Object.hasOwn(QUICK_ACTION_FEATURES, action) ? QUICK_ACTION_FEATURES[action as keyof typeof QUICK_ACTION_FEATURES] : undefined;
  if (MODULE_POLICY_ENABLED && feature && !can(feature, { ...modulePreferences(events), tier: 'free' })) return '/modules';
  const date = todayISO(), now = format(new Date(), 'HH:mm');
  useUi.getState().setDate(date);
  if (action === 'water') {
    const e: DayEntry = { id: newId(), at: atLocal(date, now), kind: 'water', status: 'done', title: t.addKinds.water, waterMl: ml };
    await saved(db.entries.add(e), t.toast.water(ml), () => db.entries.delete(e.id));
    return '/';
  }
  if (action === 'med') {
    const [plan, entries, workouts, foods] = await Promise.all([db.plan.get('main'), db.entries.where('at').startsWith(date).toArray(),
      db.workouts.toArray(), db.foods.toArray()]);
    const c = buildChecklist({ plan, date, entries, workouts, foods: new Map(foods.map((f) => [f.id, f])), now: new Date(),
      ...(MODULE_POLICY_ENABLED ? { observation: { events, now: new Date() } } : {}) });
    const next = c.items.find((i) => i.kind === 'med' && !i.done && !i.skipped);
    if (!next) { toast(t.quick.noMed); return '/'; }
    if (next.time && differenceInMinutes(new Date(), new Date(`${date}T${next.time}:00`)) > NOW_AFTER_MIN) { toast(t.quick.medLate(next.title)); return '/'; }
    const e: DayEntry = { id: newId(), at: atLocal(date, now), kind: 'med', status: 'done', title: next.title, checkKey: next.key,
      ...(next.prescriptionId ? { prescriptionId: next.prescriptionId } : {}) };
    await saved(db.entries.add(e), t.toast.marked(next.title, now), () => db.entries.delete(e.id));
    return '/';
  }
  if (action === 'symptom') return '/?open=symptom';
  if (action === 'voice') return '/?open=voice'; // D95
  if (action === 'meal') return '/meal/new';
  if (action === 'friction') return '/frictions';
  return '/';
}
