// D91: live evaluations against the real server and model — not part of `npm test`. `npm run eval:concierge`.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', include: ['tests/eval/**/*.eval.ts'], testTimeout: 600_000 } });
