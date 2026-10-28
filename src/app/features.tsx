import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { inDemo } from '../data/db';
import { useModuleEvents } from '../data/queries';
import { can, LEGACY_FEATURE_CONTEXT, type FeatureContext, type FeatureId } from '../domain/features';
import { modulePreferences } from '../domain/modulePreferences';
import { MODULE_POLICY_ENABLED } from '../domain/rollout';
import { Loading } from '../components/Recovery';
import { db } from '../data/db';
import { ensureProgressOpened } from '../data/moduleStart';

const FeatureState = createContext<FeatureContext>(LEGACY_FEATURE_CONTEXT);

/** Wait once before rendering navigation or forms, so hidden modules never flash during IndexedDB loading. */
export function FeaturesProvider({ children }: { children: ReactNode }) {
  const events = useModuleEvents();
  useEffect(() => {
    if (!MODULE_POLICY_ENABLED || inDemo()) return;
    const refresh = () => { void ensureProgressOpened(db).catch((e) => console.warn('progress opening:', (e as Error).message)); };
    refresh();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [events]);
  if (MODULE_POLICY_ENABLED && events === undefined) return <Loading />;
  const context: FeatureContext = MODULE_POLICY_ENABLED
    ? { ...modulePreferences(events ?? []), tier: 'free', demo: inDemo() } : LEGACY_FEATURE_CONTEXT;
  return <FeatureState.Provider value={context}>{children}</FeatureState.Provider>;
}

export function useFeatures() {
  const context = useContext(FeatureState);
  return { context, enabled: MODULE_POLICY_ENABLED, can: (feature: FeatureId) => can(feature, context) };
}
