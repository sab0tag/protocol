// D90: the shared reference data from Харчоблок (sab0tag/harch, seed/) — diets of Наказ МОЗ №931, dish cards,
// substitutions, products — copied into Протокол at a known commit. The harch repo is private: Vercel never reads it,
// the build uses this snapshot. Reference data only — no patient data crosses either way (harch invariant 9).
//   node scripts/harch-snapshot.mjs [path/to/harch]          — take a new snapshot
//   node scripts/harch-snapshot.mjs [path/to/harch] --check  — say whether the snapshot is behind harch
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--')) ?? '../harch/harch';
const FILES = ['diets.json', 'dishes.json', 'substitutions.json', 'products.json'];
const OUT = 'src/data/harch';
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const files = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(root, 'seed', f), 'utf8')]));

if (args.includes('--check')) {
  const was = JSON.parse(readFileSync(join(OUT, 'source.json'), 'utf8'));
  const behind = FILES.filter((f) => was.files[f] !== sha(files[f]));
  console.log(behind.length ? `behind harch ${commit.slice(0, 7)}: ${behind.join(', ')}` : `up to date with harch ${was.commit.slice(0, 7)}`);
  process.exit(behind.length ? 1 : 0);
}
mkdirSync(OUT, { recursive: true });
for (const f of FILES) writeFileSync(join(OUT, f), files[f]);
writeFileSync(join(OUT, 'source.json'), JSON.stringify({ repo: 'sab0tag/harch', path: 'seed/', commit, taken: new Date().toISOString().slice(0, 10),
  verified: false, note: 'Чернетка з Excel-прототипу харчоблоку: норми довідкові, усе не перевірено дієтологом.',
  files: Object.fromEntries(FILES.map((f) => [f, sha(files[f])])) }, null, 1) + '\n');
console.log(`snapshot of harch ${commit.slice(0, 7)} → ${OUT}`);
