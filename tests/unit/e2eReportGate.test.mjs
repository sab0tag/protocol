import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(process.cwd(), 'scripts/check-e2e-skips.mjs');
const sample = (status = 'expected', annotations = []) => ({
  suites: [{ file: 'sample.spec.ts', specs: [{ title: 'synthetic scenario', tests: [{ status, annotations, results: [] }] }] }],
  stats: { expected: status === 'expected' ? 1 : 0, skipped: status === 'skipped' ? 1 : 0,
    flaky: status === 'flaky' ? 1 : 0, unexpected: status === 'unexpected' ? 1 : 0 },
});
function run(report, mode = 'acceptance') {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-gate-'));
  try {
    const path = join(dir, 'report.json');
    writeFileSync(path, JSON.stringify(report));
    return spawnSync(process.execPath, [script, path, mode], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
describe('dual-mode E2E report gate', () => {
  it('accepts a completed report', () => expect(run(sample()).status).toBe(0));
  it('accepts a documented mode skip', () => expect(run(sample('skipped', [{ type: 'skip', description: 'Compatibility only' }]), 'compatibility').status).toBe(0));
  it('rejects missing stats', () => expect(run({ suites: [] }).status).not.toBe(0));
  it('rejects an empty report with zero counts', () => expect(run({ suites: [], stats: sample().stats }).status).not.toBe(0));
  it('rejects a skip without a reason', () => expect(run(sample('skipped')).status).not.toBe(0));
  it('rejects mismatched skip totals', () => {
    const report = sample('skipped', [{ type: 'skip', description: 'Mode gate' }]);
    report.stats.skipped = 0;
    expect(run(report).status).not.toBe(0);
  });
  it('rejects a flaky test even when retry passed', () => expect(run(sample('flaky')).status).not.toBe(0));
  it('rejects an unexpected failure', () => expect(run(sample('unexpected')).status).not.toBe(0));
  it('rejects unknown modes', () => expect(run(sample(), 'other').status).not.toBe(0));
});
