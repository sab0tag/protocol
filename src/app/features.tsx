import { createContext, useContext, type ReactNode } from 'react';
import { inDemo } from '../data/db';
import { useModuleEvents } from '../data/queries';
import { can, LEGACY_FEATURE_CONTEXT, type FeatureContext, type FeatureId } from '../domain/features';
import { modulePreferences } from '../domain/modulePreferences';
import { MODULE_POLICY_ENABLED } from '../domain/rollout';
import { Loading } from '../components/Recovery';

const FeatureState = createContext<FeatureContext>(LEGACY_FEATURE_CONTEXT);

/** Wait once before rendering navigation or forms, so hidden modules never flash during IndexedDB loading. */
export function FeaturesProvider({ children }: { children: ReactNode }) {
  const events = useModuleEvents();
  if (MODULE_POLICY_ENABLED && events === undefined) return <Loading />;
  const context: FeatureContext = MODULE_POLICY_ENABLED
    ? { ...modulePreferences(events ?? []), tier: 'free', demo: inDemo() } : LEGACY_FEATURE_CONTEXT;
  return <FeatureState.Provider value={context}>{children}</FeatureState.Provider>;
}

export function useFeatures() {
  const context = useContext(FeatureState);
  return { context, enabled: MODULE_POLICY_ENABLED, can: (feature: FeatureId) => can(feature, context) };
}
