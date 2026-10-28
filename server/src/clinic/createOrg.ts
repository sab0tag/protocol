// Operator-only: founds a clinic with its first admin and prints the admin token once. Run on the server that owns the database.
//   DB_PATH=./data/protocol.db npm run clinic:create -- "Назва клініки" "Імʼя адміністратора"
import { Store } from '../store.ts';
import { ClinicDirectory } from './directory.ts';

const [name, admin] = process.argv.slice(2);
if (!name || !admin) { console.error('usage: clinic:create "<clinic name>" "<admin name>"'); process.exit(2); }
const store = new Store(process.env.DB_PATH ?? './data/protocol.db');
const { orgId, token } = new ClinicDirectory(store.database).createOrganization(name, admin);
console.log(`organization: ${orgId}\nadmin token (shown once, store it safely): ${token}`);
