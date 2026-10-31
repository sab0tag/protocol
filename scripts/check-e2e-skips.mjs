import { readFileSync } from 'node:fs';

const [file, mode] = process.argv.slice(2);
if (!file || !mode) throw new Error('Usage: check-e2e-skips.mjs <report.json> <mode>');
let report;
try { report = JSON.parse(readFileSync(file, 'utf8')); }
catch (error) { console.error('Missing or invalid Playwright JSON report:', error); process.exit(1); }
const skipped = [], failed = [];
function walk(suites) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const item = { title: spec.title, file: suite.file ?? '', status: test.status, annotations: test.annotations ?? [] };
        if (test.status === 'skipped' || test.results?.some(r => r.status === 'skipped')) skipped.push(item);
        if (test.status === 'unexpected') failed.push(item);
      }
    }
    walk(suite.suites);
  }
}
walk(report.suites);
console.log('## E2E ' + mode);
console.log('Passed: ' + (report.stats?.expected ?? '?') + '; skipped: ' + skipped.length + '; unexpected: ' + (report.stats?.unexpected ?? '?'));
console.log('');
console.log('| Skipped scenario | Reason |');
console.log('| --- | --- |');
for (const item of skipped) {
  const reason = item.annotations.filter(a => a.type === 'skip' || a.type === 'fixme').map(a => a.description).join('; ') || 'Unspecified';
  console.log('| ' + item.title.replaceAll('|', '\\|') + ' | ' + reason.replaceAll('|', '\\|') + ' |');
}
if (failed.length || (report.stats?.unexpected ?? 0) > 0) process.exitCode = 1;
