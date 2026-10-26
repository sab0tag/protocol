/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
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
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,jpg,webp,woff2}'], importScripts: ['push-sw.js'] }, // D34: reminders
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'], // tests/e2e — Playwright (npm run e2e)
    setupFiles: ['tests/setup.ts'],
  },
});
