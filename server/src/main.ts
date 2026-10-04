import { serve } from '@hono/node-server';
import { createApp, DEFAULT_LIMITS } from './app.ts';
import { claudeRecognizer } from './photo.ts';
import { Store } from './store.ts';

const env = process.env;
const store = new Store(env.DB_PATH ?? './data/protocol.db');
const effort = (env.PHOTO_EFFORT ?? 'low') as 'low' | 'medium' | 'high';
const app = createApp({
  store,
  origins: (env.ALLOWED_ORIGINS ?? 'https://protocol.beyondthesignal.to').split(',').map((s) => s.trim()),
  recognize: env.ANTHROPIC_API_KEY ? claudeRecognizer({ model: env.PHOTO_MODEL ?? 'claude-opus-5-5', effort }) : undefined,
  limits: {
    ...DEFAULT_LIMITS,
    ...(env.PHOTOS_PER_DAY ? { photosPerDay: Number(env.PHOTOS_PER_DAY) } : {}),
    ...(env.PHOTOS_PER_VAULT_PER_DAY ? { photosPerVaultPerDay: Number(env.PHOTOS_PER_VAULT_PER_DAY) } : {}),
  },
});

const port = Number(env.PORT ?? 8080);
const server = serve({ fetch: app.fetch, port }, () => console.log(`protocol-api on :${port}, photo ${env.ANTHROPIC_API_KEY ? 'on' : 'off'}`));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { server.close(); store.close(); process.exit(0); });
