// Preparation builds keep legacy behaviour; enable only for the series' preview/acceptance builds.
export const MODULE_POLICY_ENABLED = import.meta.env.VITE_MODULE_POLICY_ENABLED === 'true';
