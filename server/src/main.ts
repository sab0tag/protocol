import { serve } from '@hono/node-server';
import { createApp, DEFAULT_LIMITS } from './app.ts';
import { ClinicDirectory } from './clinic/directory.ts';
import { PlanDelivery } from './clinic/delivery.ts';
import { backupAgeH, backupOnce, backupRecords, listBackups } from './backup.ts';
import { claudeLabel } from './label.ts';
import { claudeMenu } from './menu.ts';
import { claudeWorkout } from './workout.ts';
import { claudeLabs } from './labs.ts';
import { claudeConclusion } from './conclusion.ts';
import { claudeDish } from './dish.ts';
import { claudeDishes } from './dishes.ts';
import { claudeChat } from './chat.ts';
import { claudeMedbox } from './medbox.ts';
import { claudeNotFound } from './concierge.ts';
import { conciergeHousekeeping } from './conciergeLog.ts';
import { pilotHousekeeping } from './pilot.ts';
import { claudeRecognizer } from './photo.ts';
import { tick, vapidKeys, webPushSender } from './push.ts';
import { Store } from './store.ts';

const env = process.env;
// Migrations run here, before anything is served (ACCESS-00-M). A database this build cannot bring to its latest
// schema — newer, altered history, unrecognized, a failed step — stops the process: nothing serves a half-updated schema.
const store = (() => {
  try {
    return Store.migrated(env.DB_PATH ?? './data/protocol.db');
  } catch (e) {
    console.error(`database migration refused: ${(e as Error).message}`);
    process.exit(1);
  }
})();
const effort = (env.PHOTO_EFFORT ?? 'low') as 'low' | 'medium' | 'high';
const backups = env.BACKUP_DIR ?? '/backups';
const vapid = vapidKeys(store, env);
const send = webPushSender(vapid, env.VAPID_SUBJECT ?? 'https://protocol.beyondthesignal.to');
const clinic = new ClinicDirectory(store.database);
const app = createApp({
  store,
  clinic,
  planDelivery: new PlanDelivery(store.database, clinic),
  push: { publicKey: vapid.publicKey, send },
  backupAgeH: () => backupAgeH(backups, new Date()),
  backups: { list: () => listBackups(backups), records: (name, vault) => backupRecords(backups, name, vault) },
  origins: (env.ALLOWED_ORIGINS ?? 'https://protocol.beyondthesignal.to').split(',').map((s) => s.trim()),
  recognize: env.ANTHROPIC_API_KEY ? claudeRecognizer({ model: env.PHOTO_MODEL ?? 'claude-opus-5-5', effort }) : undefined,
  label: env.ANTHROPIC_API_KEY ? claudeLabel({ model: env.PHOTO_MODEL ?? 'claude-opus-5-5', effort }) : undefined,
  labs: env.ANTHROPIC_API_KEY ? claudeLabs({ model: env.PHOTO_MODEL ?? 'claude-opus-5-5', effort }) : undefined, // D68
  conclusion: env.ANTHROPIC_API_KEY ? claudeConclusion({ model: env.PHOTO_MODEL ?? 'claude-opus-5-5', effort }) : undefined, // D80
  medbox: env.ANTHROPIC_API_KEY ? claudeMedbox({ model: env.PHOTO_MODEL ?? 'claude-opus-5-5', effort }) : undefined, // D89
  notFound: env.ANTHROPIC_API_KEY ? claudeNotFound({ model: env.CONCIERGE_MODEL ?? env.PHOTO_MODEL ?? 'claude-opus-5-5', effort: 'low' }) : undefined, // D91
  conciergeModel: env.CONCIERGE_MODEL ?? env.PHOTO_MODEL ?? 'claude-opus-5-5',
  menu: env.ANTHROPIC_API_KEY
    ? claudeMenu({ model: env.MENU_MODEL ?? 'claude-opus-5-5', effort: (env.MENU_EFFORT ?? 'medium') as 'low' | 'medium' | 'high' }) : undefined,
  chat: env.ANTHROPIC_API_KEY // D117
    ? claudeChat({ model: env.CONCIERGE_MODEL ?? env.PHOTO_MODEL ?? 'claude-opus-5-5', effort: 'low' }) : undefined,
  dishes: env.ANTHROPIC_API_KEY // D123
    ? claudeDishes({ model: env.MENU_MODEL ?? 'claude-opus-5-5', effort: 'low' }) : undefined,
  dish: env.ANTHROPIC_API_KEY // D110
    ? claudeDish({ model: env.MENU_MODEL ?? 'claude-opus-5-5', effort: 'low' }) : undefined,
  workout: env.ANTHROPIC_API_KEY // D63
    ? claudeWorkout({ model: env.WORKOUT_MODEL ?? 'claude-opus-5-5', effort: (env.WORKOUT_EFFORT ?? 'low') as 'low' | 'medium' | 'high' }) : undefined,
  disabledAi: (env.AI_DISABLED ?? '').split(',').map((k) => k.trim()).filter(Boolean),
  limits: {
    ...DEFAULT_LIMITS,
    ...(env.PHOTOS_PER_DAY ? { photosPerDay: Number(env.PHOTOS_PER_DAY) } : {}),
    ...(env.PHOTOS_PER_VAULT_PER_DAY ? { photosPerVaultPerDay: Number(env.PHOTOS_PER_VAULT_PER_DAY) } : {}),
    ...(env.MENUS_PER_VAULT_PER_DAY ? { menusPerVaultPerDay: Number(env.MENUS_PER_VAULT_PER_DAY) } : {}),
    ...(env.WORKOUTS_PER_VAULT_PER_DAY ? { workoutsPerVaultPerDay: Number(env.WORKOUTS_PER_VAULT_PER_DAY) } : {}),
    ...(env.VAULTS_PER_IP_PER_DAY ? { vaultsPerIpPerDay: Number(env.VAULTS_PER_IP_PER_DAY) } : {}), // e2e only
    ...(env.DEVICE_TOKENS_PER_IP_PER_DAY ? { deviceTokensPerIpPerDay: Number(env.DEVICE_TOKENS_PER_IP_PER_DAY) } : {}), // e2e only: every test is a new device
    ...(env.AI_PER_DAY ? { aiPerDay: Number(env.AI_PER_DAY) } : {}),
    ...(env.AI_DAY_USD ? { aiDayUsdMicro: Number(env.AI_DAY_USD) * 1_000_000 } : {}),
    ...(env.AI_MONTH_USD ? { aiMonthUsdMicro: Number(env.AI_MONTH_USD) * 1_000_000 } : {}),
    ...(env.PILOT_JOINS_PER_IP_PER_DAY ? { pilotJoinsPerIpPerDay: Number(env.PILOT_JOINS_PER_IP_PER_DAY) } : {}), // e2e only
  },
});

const port = Number(env.PORT ?? 8080);
const server = serve({ fetch: app.fetch, port }, () => console.log(`protocol-api on :${port}, photo and menu ${env.ANTHROPIC_API_KEY ? 'on' : 'off'}`));
let busy = false;
const timer = setInterval(() => {
  if (busy) return;
  busy = true;
  tick(store, send, Date.now()).catch((e) => console.error('tick failed:', (e as Error).message)).finally(() => { busy = false; });
}, 20_000);
// D36: a backup a day — checked hourly, made once per date (after 03:00 Kyiv ≈ 00:00–01:00 UTC)
const backupTimer = setInterval(() => {
  backupOnce(store, backups, new Date()).catch((e) => console.error('backup failed:', (e as Error).message));
  try { conciergeHousekeeping(store, `${backups}/concierge`, new Date()); } catch (e) { console.error('concierge log housekeeping failed:', (e as Error).message); } // D91
  try { pilotHousekeeping(store, new Date()); } catch (e) { console.error('pilot housekeeping failed:', (e as Error).message); } // D119
}, 3600_000);
setTimeout(() => backupOnce(store, backups, new Date()).catch((e) => console.error('backup failed:', (e as Error).message)), 60_000);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { clearInterval(timer); clearInterval(backupTimer); server.close(); store.close(); process.exit(0); });
