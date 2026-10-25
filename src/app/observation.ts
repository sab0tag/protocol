// Temporary rollout switch. The complete module policy is enabled only after migration, metrics and push are ready.
import { useEffect, useState } from 'react';
import { inDemo } from '../data/db';
import { useModuleEvents } from '../data/queries';
import type { Observation } from '../domain/observation';

export const MODULE_POLICY_ENABLED = import.meta.env.VITE_MODULE_POLICY_ENABLED === 'true';

export function useObservation(): { observation: Observation | undefined; ready: boolean } {
  const events = useModuleEvents();
  const [, setClock] = useState(0);
  useEffect(() => {
    if (!MODULE_POLICY_ENABLED) return;
    const refresh = () => setClock((n) => n + 1);
    const timer = setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return { observation: MODULE_POLICY_ENABLED ? { events: events ?? [], now: new Date(), demo: inDemo() } : undefined,
    ready: !MODULE_POLICY_ENABLED || events !== undefined };
}
