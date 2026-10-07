import { useEffect, useState } from 'react';
import { t } from '../i18n/uk';
import { usage } from '../sync/api';
import { currentKeys } from '../sync/runner';

/** D36: this month's AI use of the person's vault — calls and an estimate in dollars. */
export function AiSpend() {
  const [u, setU] = useState<{ kinds: Record<string, number>; usd: number } | null>(null);
  useEffect(() => { const k = currentKeys(); if (k) usage(k).then(setU).catch(() => undefined); }, []);
  if (!u) return null;
  return <p className="text-xs text-muted">{t.menu.spend(u.kinds.menu ?? 0, u.kinds.photo ?? 0, u.usd.toFixed(2).replace('.', ','))}</p>;
}
