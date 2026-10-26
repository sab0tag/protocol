import { useEffect, useRef, useState } from 'react';
import { useFeatures } from '../app/features';
import { useObservation } from '../app/observation';
import { db } from '../data/db';
import { markLightDayNoticeShown } from '../data/lightDay';
import { lightDayNotice } from '../domain/lightDay';
import { todayISO } from '../domain/dates';
import { t } from '../i18n/uk';

export function LightDayNotice({ date }: { date: string }) {
  const { enabled, context } = useFeatures(), { observation } = useObservation();
  const [shown, setShown] = useState<{ episode: string; count: number }>();
  const [closed, setClosed] = useState(false);
  const box = useRef<HTMLElement>(null);
  const events = observation?.events;
  const eligible = enabled && !context.demo && date === todayISO();
  useEffect(() => {
    if (eligible && events && !shown && !closed) setShown(lightDayNotice(events, new Date()));
  }, [events, eligible, shown, closed]);
  useEffect(() => {
    if (!shown || !box.current || !eligible) return;
    let claimed = false;
    const observer = new IntersectionObserver((rows) => {
      if (!rows.some((r) => r.isIntersecting) || claimed || date !== todayISO()) return;
      claimed = true;
      void markLightDayNoticeShown(db, shown.episode).then((written) => { if (!written) setClosed(true); }).catch(() => { /* keep the card; retry after a future visit */ });
    });
    observer.observe(box.current); return () => observer.disconnect();
  }, [shown, eligible, date]);
  if (!eligible || !shown || closed || !events || lightDayNotice(events.filter((e) => e.kind !== 'light-day-notice'), new Date())?.episode !== shown.episode) return null;
  return <section ref={box} aria-label={t.lightDay.noticeTitle} className="mb-3 space-y-2 rounded-2xl border border-line bg-surface p-3 text-sm">
    <h2 className="font-medium">{t.lightDay.noticeTitle}</h2><p>{t.lightDay.noticeText}</p>
    <button type="button" onClick={() => setClosed(true)} className="min-h-tap text-accent underline">{t.lightDay.noticeClose}</button>
  </section>;
}
