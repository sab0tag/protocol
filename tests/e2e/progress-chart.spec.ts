import { addDays } from 'date-fns';
import { expect, test } from '@playwright/test';
import { device, seed, ymd } from './helpers';

test('weight history is a responsive line chart of weekly averages, not bars', async ({ browser }) => {
  const page = await device(browser);
  await seed(page, [-28, -21, -14, -7].map((days, index) => {
    const date = addDays(new Date(), days);
    return { store: 'weights', value: { date: ymd(date), kg: 100 - index * 2 } };
  }));
  await page.goto('./#/progress');

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
