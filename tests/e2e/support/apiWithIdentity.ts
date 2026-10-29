// Only the E2E server uses this synthetic issuer/CA and explicit pre-linked test memberships.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../../../server/src/store.ts';
import { ClinicDirectory } from '../../../server/src/clinic/directory.ts';
import { fakeOidc } from '../../../server/test/support/fakeOidc.ts';

const cert = resolve('.e2e/issuer.crt'), key = resolve('.e2e/issuer.key');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
  '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' });
const fake = await fakeOidc({}, { key: readFileSync(key, 'utf8'), cert: readFileSync(cert, 'utf8') });
const store = Store.migrated(process.env.DB_PATH!), dir = new ClinicDirectory(store.database);
const clinic = dir.createOrganization('Synthetic OIDC Clinic', 'Synthetic OIDC Admin');
const admin = dir.authenticate(clinic.token)!;
const second = dir.createOrganization('Synthetic OIDC Second Clinic', 'Synthetic OIDC Second Admin');
store.database.prepare('UPDATE organization_memberships SET account_id = ? WHERE id = ?').run(clinic.adminId, second.adminId);
const doctor = dir.addStaff(admin, { displayName: 'Synthetic OIDC Doctor', role: 'doctor' });
for (const [subject, memberId] of [['admin', clinic.adminId], ['doctor', doctor.memberId]]) {
  store.database.prepare("UPDATE accounts SET status = 'active' WHERE id = ?").run(memberId!);
  store.database.prepare('INSERT INTO external_identities VALUES (?, ?, ?, ?)').run(fake.issuer, subject!, memberId!, Date.now());
}
store.close();
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/main.ts'], { stdio: 'inherit', env: {
  ...process.env, NODE_EXTRA_CA_CERTS: cert, CLINIC_IDENTITY_V2: 'on', OIDC_ISSUER: fake.issuer,
  OIDC_CLIENT_ID: fake.clientId, OIDC_CLIENT_SECRET: fake.clientSecret, APP_ORIGIN: 'http://localhost:4318',
  OIDC_REDIRECT_URI: 'http://localhost:8099/v1/auth/callback',

} });
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; child.kill('SIGTERM'); void fake.close(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
child.on('exit', code => { void fake.close().then(() => process.exit(code ?? 1)); });
