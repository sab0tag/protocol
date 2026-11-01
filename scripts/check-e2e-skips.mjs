import { readFileSync } from 'node:fs';

const [file, mode] = process.argv.slice(2);
if (!file || !['compatibility', 'acceptance'].includes(mode)) {
  throw new Error('Usage: check-e2e-skips.mjs <report.json> <compatibility|acceptance>');
}

let report;
try { report = JSON.parse(readFileSync(file, 'utf8')); }
catch (error) { console.error('Missing or invalid Playwright JSON report:', error); process.exit(1); }

const stats = report?.stats;
const counters = ['expected', 'skipped', 'flaky', 'unexpected'];
if (!Array.isArray(report?.suites) || !stats || counters.some(k => !Number.isSafeInteger(stats[k]) || stats[k] < 0)) {
  console.error('Invalid Playwright JSON: suites and nonnegative integer stats are required.');
  process.exit(1);
}

const skipped = [], unexpected = [];
let total = 0;
function walk(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        total++;
        const item = { title: spec.title ?? '', file: suite.file ?? '', status: test.status, annotations: test.annotations ?? [] };
        if (test.status === 'skipped' || test.results?.some(r => r.status === 'skipped')) skipped.push(item);
        if (test.status === 'unexpected') unexpected.push(item);
      }
    }
    walk(suite.suites ?? []);
  }
}
walk(report.suites);

console.log('## E2E ' + mode);
console.log('Passed: ' + stats.expected + '; skipped: ' + skipped.length + '; flaky: ' + stats.flaky + '; unexpected: ' + stats.unexpected);
console.log('');
console.log('| Skipped scenario | Reason |');
console.log('| --- | --- |');
let unexplained = 0;
for (const item of skipped) {
  const reason = item.annotations.filter(a => a.type === 'skip' || a.type === 'fixme').map(a => a.description?.trim()).filter(Boolean).join('; ');
  if (!reason) unexplained++;
  console.log('| ' + item.title.replaceAll('|', '\\|') + ' | ' + (reason || 'Unspecified').replaceAll('|', '\\|') + ' |');
}

// Fail closed if the reporter silently returned an empty/partial report, or
// if a skip has no documented reason. Passing retries are still flaky failures.
if (total === 0 || stats.skipped !== skipped.length ||
    stats.expected + stats.skipped + stats.flaky + stats.unexpected !== total ||
    unexplained > 0 || unexpected.length > 0 || stats.unexpected > 0 || stats.flaky > 0) {
  console.error('E2E gate failed:', { total, skipped: skipped.length, stats, unexplained, unexpected: unexpected.length });
  process.exitCode = 1;
}
