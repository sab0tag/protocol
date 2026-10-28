import { expect, test } from '@playwright/test';

test('landing is served as standalone HTML rather than SPA fallback', async ({ page }) => {
  const response = await page.goto('./landing/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-type']).toContain('text/html');
  await expect(page).toHaveTitle(/Protocol/);
  await expect(page.getByRole('heading', { level: 1, name: /Менше тримати в голові/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Спробувати Protocol/ })).toBeVisible();
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
