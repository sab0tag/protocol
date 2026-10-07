import { serve } from '@hono/node-server';
import { createApp, DEFAULT_LIMITS } from './app.ts';
import { claudeMenu } from './menu.ts';
import { claudeRecognizer } from './photo.ts';
import { tick, vapidKeys, webPushSender } from './push.ts';
import { Store } from './store.ts';

const env = process.env;
const store = new Store(env.DB_PATH ?? './data/protocol.db');
const effort = (env.PHOTO_EFFORT ?? 'low') as 'low' | 'medium' | 'high';
const vapid = vapidKeys(store, env);
const send = webPushSender(vapid, env.VAPID_SUBJECT ?? 'https://protocol.beyondthesignal.to');
const app = createApp({
  store,
  push: { publicKey: vapid.publicKey, send },
  origins: (env.ALLOWED_ORIGINS ?? 'https://protocol.beyondthesignal.to').split(',').map((s) => s.trim()),
  recognize: env.ANTHROPIC_API_KEY ? claudeRecognizer({ model: env.PHOTO_MODEL ?? 'claude-opus-5-5', effort }) : undefined,
  menu: env.ANTHROPIC_API_KEY
    ? claudeMenu({ model: env.MENU_MODEL ?? 'claude-opus-5-5', effort: (env.MENU_EFFORT ?? 'medium') as 'low' | 'medium' | 'high' }) : undefined,
  limits: {
    ...DEFAULT_LIMITS,
    ...(env.PHOTOS_PER_DAY ? { photosPerDay: Number(env.PHOTOS_PER_DAY) } : {}),
    ...(env.PHOTOS_PER_VAULT_PER_DAY ? { photosPerVaultPerDay: Number(env.PHOTOS_PER_VAULT_PER_DAY) } : {}),
    ...(env.MENUS_PER_VAULT_PER_DAY ? { menusPerVaultPerDay: Number(env.MENUS_PER_VAULT_PER_DAY) } : {}),
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
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { clearInterval(timer); server.close(); store.close(); process.exit(0); });
