import { addDays } from 'date-fns';
import { expect, test } from '@playwright/test';
import { device, ymd } from './helpers';

test('progress summary uses honest weekly rings and weight history remains a line chart', async ({ browser }) => {
  const page = await device(browser, 'demo');
  const weights = [-28, -21, -14, -7].map((days, index) => ({ date: ymd(addDays(new Date(), days)), kg: 100 - index * 2 }));
  // Demo mode has its own database. Replace its weight fixture, leaving its real coverage records intact.
  await page.evaluate(async rows => {
    const req = indexedDB.open('protocol-demo');
    await new Promise<void>((resolve, reject) => { req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); });
    try {
      const tx = req.result.transaction('weights', 'readwrite');
      const store = tx.objectStore('weights'); store.clear(); rows.forEach(row => store.put(row));
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    } finally { req.result.close(); }
  }, weights);
  await page.goto('./#/progress');

  await expect(page.getByRole('heading', { name: /Останні 7 днів/ })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Вуглеводи в межах' })).toHaveAttribute('aria-valuetext', '0 з 6 дн.');
  await expect(page.getByRole('progressbar', { name: 'Білок ≥ 90 % цілі' })).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByRole('progressbar', { name: 'Вода — норма' })).toHaveAttribute('aria-valuetext', '4 з 6 дн.');
  await expect(page.getByRole('progressbar', { name: 'План дня' })).toHaveAttribute('aria-valuetext', '64 %');
  await expect(page.getByRole('progressbar', { name: 'Тренувань' })).toHaveCount(0);
  await expect(page.getByRole('figure', { name: 'Виміри ваги, кг', exact: true })).toBeVisible();
  await page.getByText('Тижневі середні та темп', { exact: true }).click();
  const chart = page.getByRole('img', { name: /Середня вага за тижнями/ });
  await expect(chart).toBeVisible();
  await expect(chart.locator('.recharts-line-curve')).toHaveCount(1);
  await expect(chart.locator('.recharts-bar')).toHaveCount(0);

  await page.getByText('Таблицею', { exact: true }).click();
  for (const weight of weights) await expect(page.getByRole('cell', { name: `${weight.kg} кг`, exact: true })).toBeVisible();

  for (const width of [320, 390, 768, 1024]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme });
      await chart.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await chart.screenshot({ path: `test-results/weight-line-${width}-${colorScheme}.png` });
    }
  }
  await page.context().close();
});
