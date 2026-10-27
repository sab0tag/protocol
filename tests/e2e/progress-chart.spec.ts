import { addDays } from 'date-fns';
import { expect, test } from '@playwright/test';
import { device, seed, ymd } from './helpers';

test('progress summary uses honest weekly rings and weight history remains a line chart', async ({ browser }) => {
  const page = await device(browser, 'demo');
  await seed(page, [-28, -21, -14, -7].map((days, index) => {
    const date = addDays(new Date(), days);
    return { store: 'weights', value: { date: ymd(date), kg: 100 - index * 2 } };
  }));
  await page.goto('./#/progress');

  await expect(page.getByRole('heading', { name: /Останні 7 днів/ })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Вуглеводи в межах' })).toHaveAttribute('aria-valuetext', '0 з 6 дн.');
  await expect(page.getByRole('progressbar', { name: 'Білок ≥ 90 % цілі' })).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByRole('progressbar', { name: 'Вода — норма' })).toHaveAttribute('aria-valuetext', '4 з 6 дн.');
  await expect(page.getByRole('progressbar', { name: 'План дня' })).toHaveAttribute('aria-valuetext', '64 %');
  await expect(page.getByRole('progressbar', { name: 'Тренувань' })).toHaveCount(0);
  const chart = page.getByRole('img', { name: /Середня вага за тижнями/ });
  await expect(chart).toBeVisible();
  await expect(chart.locator('.recharts-line-curve')).toHaveCount(1);
  await expect(chart.locator('.recharts-bar')).toHaveCount(0);

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
