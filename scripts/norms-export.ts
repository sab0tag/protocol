// D197: the norms sheets for doctors, one file per specialty, from src/domain/norms.ts — `npm run norms:export`.
// tests/unit/norms.test.ts fails while docs/norms/ differs from the code, so a changed norm is re-exported in the same PR.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { SPECIALTIES } = await vite.ssrLoadModule('/src/domain/norms.ts') as typeof import('../src/domain/norms');
  const { normsSheet } = await vite.ssrLoadModule('/src/domain/normsSheet.ts') as typeof import('../src/domain/normsSheet');
  const dir = new URL('../docs/norms/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const s of Object.keys(SPECIALTIES) as (keyof typeof SPECIALTIES)[]) {
    writeFileSync(new URL(`${s}.md`, dir), normsSheet(s));
    console.log(`docs/norms/${s}.md`);
  }
} finally { await vite.close(); }
