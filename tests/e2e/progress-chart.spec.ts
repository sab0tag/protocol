import { addDays } from 'date-fns';
import { expect, test } from '@playwright/test';
import { device, ymd } from './helpers';

test('weight history remains a line chart on its own screen', async ({ browser }) => {
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
  // Native IndexedDB writes bypass Dexie's live-query notifications. A hash-only
  // navigation can retain the already-mounted demo weights; reload the app so
  // the progress screen reads the fixture from disk rather than cached state.
  await page.reload();
  await page.goto('./#/progress');

  await page.goto('./#/weight'); // D165: «Результати» is a phrase and three numbers; the weight chart lives on its own screen
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

test('each part of «Результати» opens its own records (D146, D165)', async ({ browser }) => {
  const page = await device(browser, 'demo');
  await page.goto('./#/progress');
  const more = page.getByRole('navigation', { name: 'Докладніше' });
  for (const [name, url] of [['Самопочуття', /#\/wellbeing\/journal$/], ['Вага', /#\/weight$/], ['Тиждень докладно', /#\/week$/], ['Аналізи', /#\/progress\/labs$/]] as const) {
    await more.getByRole('link', { name, exact: true }).click(); await expect(page).toHaveURL(url); await page.goBack();
  }
  await page.context().close();
});
