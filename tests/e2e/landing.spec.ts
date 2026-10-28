import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('landing is served as standalone HTML rather than SPA fallback', async ({ page }) => {
  const response = await page.goto('./landing/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-type']).toContain('text/html');
  await expect(page).toHaveTitle(/Protocol/);
  await expect(page.getByRole('heading', { level: 1, name: /Менше тримати в голові/ })).toBeVisible();
  const ctas = page.getByRole('link', { name: /Спробувати Protocol/ });
  await expect(ctas).toHaveCount(2);
  for (const cta of await ctas.all()) await expect(cta).toBeVisible();
  const hasStyles = await page.evaluate(() => {
    const hero = document.querySelector('.hero');
    return !!hero && getComputedStyle(hero).display === 'grid';
  });
  expect(hasStyles).toBe(true);
});

test('landing keeps CTA and demo readable on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('./landing/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Подивитися, як працює/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// Exercise the deployed CSP locally too: Vite preview does not apply vercel.json headers.
test('landing demo works under the deployment security policy', async ({ page }) => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const csp = config.headers[0].headers.find((h: { key: string }) => h.key === 'Content-Security-Policy').value;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/landing/**', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
  });
  await page.goto('./landing/');
  await page.getByRole('button', { name: /Не знаю, що можна їсти/ }).click();
  await expect(page.locator('#demo-title')).toHaveText('Зрозумійте попередження');
  await page.getByRole('button', { name: /Хочу бачити свій прогрес/ }).click();
  await expect(page.locator('#demo-title')).toHaveText('Помічайте зміни');
  expect(errors).toEqual([]);
});

test('installed app worker does not replace the landing with the SPA shell', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve =>
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
  });
  // Vite preview lacks Vercel rewrites. Apply the exact configured bare-path
  // rewrite at the network boundary; an incorrect SW fallback bypasses it.
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const rewrite = config.rewrites.find((r: { source: string }) => r.source === '/landing');
  expect(rewrite?.destination).toBe('/landing/index.html');
  await page.route('**/landing', async route => {
    const response = await route.fetch({ url: new URL(rewrite.destination, route.request().url()).href });
    await route.fulfill({ response });
  });
  for (const path of ['landing', 'landing/', 'landing/index.html']) {
    await page.goto(`./${path}`);
    await expect(page.getByRole('heading', { level: 1, name: /Менше тримати в голові/ })).toBeVisible();
    await expect(page.locator('#root')).toHaveCount(0);
  }
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test(`landing layout ${width} ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('./landing/');
      await expect(page.getByRole('heading', { level: 1, name: /Менше тримати в голові/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/landing-${width}-${colorScheme}.png`, fullPage: true });
    });
  }
}
