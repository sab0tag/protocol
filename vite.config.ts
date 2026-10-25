/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { build as viteBuild, defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

let modulePolicyEnabled = false;
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'shared-reminder-policy',
      configResolved(config) { modulePolicyEnabled = config.env.VITE_MODULE_POLICY_ENABLED === 'true'; },
      async generateBundle() {
        const result = await viteBuild({ configFile: false, logLevel: 'silent', publicDir: false, build: { write: false, minify: false,
          outDir: 'node_modules/.cache/reminder-policy', emptyOutDir: false,
          lib: { entry: new URL('./server/src/reminderPolicy.ts', import.meta.url).pathname, name: 'ProtocolReminderPolicy', formats: ['iife'] } } });
        const outputs = Array.isArray(result) ? result : 'output' in result ? [result] : [];
        const chunk = outputs[0]?.output.find((o) => o.type === 'chunk');
        if (!chunk) this.error('Shared reminder policy was not built');
        this.emitFile({ type: 'asset', fileName: 'reminder-policy.js', source: chunk.code
          + `\nself.PROTOCOL_MODULE_POLICY_ENABLED = ${modulePolicyEnabled};\n` });
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'push-sw.js', 'meds-index.json'], // D89: the register works offline
      manifest: {
        name: 'Протокол',
        short_name: 'Протокол',
        description: 'План лікаря — щоденні дії',
        lang: 'uk',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#F4F2EE',
        theme_color: '#2F6B4F',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,jpg,woff2}'], importScripts: ['reminder-policy.js', 'push-sw.js'] }, // D136: one policy for API, client and worker
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'], // tests/e2e — Playwright (npm run e2e)
    setupFiles: ['tests/setup.ts'],
  },
});
