// D91: the concierge corpus, scenario 1, live — each row five times against the real server and model (a single lucky
// answer is not enough: a boundary must hold every time). Not in `npm test` (network, a model, money): `npm run eval:concierge`.
// Uses a throwaway vault of its own; logs nothing (log: false).
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import corpus from '../fixtures/concierge-cases.yaml?raw';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { conciergeNotFound, createVault } from '../../src/sync/api';
import { deriveKeys, newCode, parseCode } from '../../src/sync/crypto';

interface Row { id: string; scenario: string; input?: string; status: 'fixed' | 'open'
  expect: { candidates_from_db?: boolean; candidates_max?: number; includes_any?: string[]; empty?: boolean } }
const RUNS = 5;
const rows = (parse(corpus) as Row[]).filter((r) => r.scenario === 'not_found');
const names = [...FOODS.map((f) => f.name), ...RECIPES.map((r) => r.name)];
test('scenario 1, live, five runs a row', async () => {
const keys = await deriveKeys(parseCode(newCode())!);
await createVault(keys);
let failed = 0;
for (const row of rows) {
  const bad: string[] = [];
  for (let i = 0; i < RUNS; i++) {
    const { candidates } = await conciergeNotFound(keys, { text: row.input!, names, log: false, versions: { app: 'eval', plan: '' }, context: {} });
    const w = row.expect;
    if (w.candidates_from_db && !candidates.every((c) => names.includes(c))) bad.push(`#${i + 1} не з бази: ${candidates.join(', ')}`);
    if (w.candidates_max !== undefined && candidates.length > w.candidates_max) bad.push(`#${i + 1} більше ${w.candidates_max}`);
    if (w.empty && candidates.length) bad.push(`#${i + 1} мало бути порожньо: ${candidates.join(', ')}`);
    if (w.includes_any && !candidates.some((c) => w.includes_any!.includes(c))) bad.push(`#${i + 1} немає жодної з ${w.includes_any.join(' / ')}: ${candidates.join(', ') || '—'}`);
    if (i === 0) console.log(`  ${row.id}: ${candidates.join(' | ') || '—'}`);
  }
  const ok = bad.length === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${row.status} ${row.id} (${RUNS - new Set(bad.map((b) => b.split(' ')[0])).size}/${RUNS})${ok ? '' : `\n    ${bad.join('\n    ')}`}`);
  if (!ok && row.status === 'fixed') failed++;
  if (ok && row.status === 'open') { console.log(`    ${row.id} проходить ${RUNS}/${RUNS} — переведіть у fixed`); failed++; }
}
expect(failed).toBe(0);
}, 600_000);
