// D91: live evaluations against the real server and model — not part of `npm test`. `npm run eval:concierge`.
import { defineConfig } from 'vitest/config';

// D201: evals never run on the production key. The model comparisons go through the Batch API on the eval key
// (`npm run eval:batch`); an eval aimed at the production server stops here. The one exception is the smoke of a server
// deploy (zzSmoke.eval.ts), which checks the deployed server itself — only with SMOKE=1, never as part of an eval run.
if (/beyondthesignal\.to/.test(process.env.VITE_API_URL ?? '') && process.env.SMOKE !== '1')
  throw new Error('D201: evals do not use the production key — run `npm run eval:batch` (Batch API, ~/.protocol-keys/anthropic-eval)');

export default defineConfig({ test: { environment: 'node', include: ['tests/eval/**/*.eval.ts'], testTimeout: 600_000 } });
