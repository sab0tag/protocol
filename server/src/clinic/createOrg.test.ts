import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { Store } from '../store.ts';
import { createOrg } from './createOrg.ts';
import { ClinicDirectory } from './directory.ts';

const run = (args: string[], db: string | undefined) => {
  const out: string[] = [], err: string[] = [];
  const code = createOrg(args, db, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
};

it('refuses without DB_PATH or with a path where no database is — never founds a clinic in a fresh empty file', () => {
  expect(run(['Клініка', 'Адмін'], undefined)).toMatchObject({ code: 2, err: expect.stringMatching(/DB_PATH/) });
  const missing = join(mkdtempSync(join(tmpdir(), 'clinic-')), 'nope.db');
  expect(run(['Клініка', 'Адмін'], missing)).toMatchObject({ code: 2, err: expect.stringMatching(/no database/) });
  expect(existsSync(missing)).toBe(false);
  expect(run(['Клініка'], missing).code).toBe(2);
});

it('founds the clinic in the live database; the printed token signs its admin in; bad names are a message, not a stack', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'clinic-')), 'live.db');
  Store.migrated(path).close();
  const r = run(['Клініка', 'Адмін'], path);
  expect(r.code).toBe(0);
  const token = /admin token[^:]*: (\S+)/.exec(r.out)![1]!;
  expect(new ClinicDirectory(new DatabaseSync(path)).authenticate(token)).toMatchObject({ role: 'admin' });
  expect(run(['x'.repeat(201), 'Адмін'], path)).toMatchObject({ code: 2, err: expect.stringMatching(/rejected: bad_request/) });
});
