// Browser tests (D40): the built app (with its service worker) against a local API server.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  // a phone-sized Chromium (the iPhone preset's mobile mode turns notifications off in Chromium)
  use: { baseURL: 'http://localhost:4318/', timezoneId: 'Europe/Kyiv', locale: 'uk-UA', browserName: 'chromium', channel: 'chromium', viewport: { width: 390, height: 844 },
    permissions: ['notifications', 'clipboard-read', 'clipboard-write'] },
  webServer: [
    { command: 'npm run build:e2e && vite preview --outDir dist-e2e --port 4318 --strictPort', url: 'http://localhost:4318/', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'rm -rf .e2e && mkdir -p .e2e && node --disable-warning=ExperimentalWarning server/src/main.ts', url: 'http://localhost:8099/health', reuseExistingServer: false,
      env: { PORT: '8099', DB_PATH: '.e2e/api.db', BACKUP_DIR: '.e2e', ALLOWED_ORIGINS: 'http://localhost:4318', VAULTS_PER_IP_PER_DAY: '1000', DEVICE_TOKENS_PER_IP_PER_DAY: '1000', PILOT_JOINS_PER_IP_PER_DAY: '1000' } },
  ],
});
