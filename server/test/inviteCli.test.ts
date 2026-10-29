import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { migrate, MIGRATIONS } from '../src/db/migrate.ts';
import { inviteCli } from '../src/clinic/inviteCli.ts';
it('operator invitation CLI validates only: a v4 database is not migrated or modified', async () => {
  const folder = mkdtempSync(join(tmpdir(),'protocol-invite-cli-')), path = join(folder,'db.sqlite');
  const db = new DatabaseSync(path);
  try {
    migrate(db,MIGRATIONS().slice(0,4));
    const history = db.prepare('SELECT * FROM schema_migrations').all(), schema = db.prepare('SELECT sql FROM sqlite_schema ORDER BY name').all();
    const errors: string[] = [], output: string[] = [];
    expect(await inviteCli(['synthetic-org','synthetic-member','recipient@example.invalid'], { DB_PATH:path, APP_ORIGIN:'https://app.test',
      STAFF_SMTP_HOST:'smtp.example.invalid', STAFF_SMTP_FROM:'protocol@example.invalid', STAFF_SMTP_USER:'synthetic', STAFF_SMTP_PASSWORD:'synthetic' }, s => output.push(s), s => errors.push(s))).toBe(3);
    expect(errors).toEqual(['invitation refused: pending']); expect(output).toEqual([]);
    expect(db.prepare('SELECT * FROM schema_migrations').all()).toEqual(history); expect(db.prepare('SELECT sql FROM sqlite_schema ORDER BY name').all()).toEqual(schema);
  } finally { db.close(); rmSync(folder,{ recursive:true, force:true }); }
});
it('missing bootstrap configuration refuses without creating a database or exposing a secret', async () => {
  const errors: string[] = [];
  expect(await inviteCli([],{},()=>{throw Error('unexpected output');},s=>errors.push(s))).toBe(2); expect(errors).toHaveLength(1);
});
