import { expect, test } from '@playwright/test';
import { device } from './helpers';

const routes = ['/', '/food', '/workout', '/plan', '/progress', '/more'];

test('foldable viewport transitions keep navigation and content usable', async ({ browser }) => {
  const page = await device(browser, 'demo');
  for (const width of [360, 884, 1100, 360]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto('./#' + route);
      await expect(page.locator('main h1').first()).toBeVisible();
      const geometry = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Розділи"]')!.getBoundingClientRect();
        const main = document.querySelector('main')!.getBoundingClientRect();
        return { scrollWidth: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
          navRight: nav.right, navBottom: nav.bottom, mainLeft: main.left, mainTop: main.top };
      });
      expect(geometry.scrollWidth, `${width}px ${route} overflows`).toBeLessThanOrEqual(geometry.viewport + 1);
      if (width < 768) {
        expect(geometry.navBottom).toBeGreaterThan(geometry.mainTop);
      } else {
        expect(geometry.mainLeft).toBeGreaterThanOrEqual(geometry.navRight - 1);
      }
    }
  }
  await page.context().close();
});
