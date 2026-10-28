import { expect, test } from '@playwright/test';
import { device, seed } from './helpers';
test('timeline clock states preserve outcomes and small navigation remains usable with reduced motion', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.clock.install({ time: new Date('2026-10-28T11:00:00+02:00') });
  await seed(page, ['08:00', '12:00', '15:00'].map((time, i) => ({ store: 'entries', value: { id: `synthetic-${i}`, kind: 'meal', status: 'planned', title: `Synthetic ${time}`, at: `2026-10-28T${time}:00+02:00` } })));
  await page.goto('./#/');
  const upcoming = page.locator('.protocol-rhythm-node[aria-current=step]');
  await expect(upcoming).toContainText('Synthetic 12:00');
  await expect(page.locator('.protocol-rhythm-node[data-phase=past]')).toContainText('Synthetic 08:00');
  await expect(page.locator('.protocol-rhythm-node[data-phase=future]')).toContainText('Synthetic 15:00');
  for (const width of [320, 375, 390, 1024]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ colorScheme });
    const tabs = page.getByRole('navigation', { name: 'Розділи', exact: true }).getByRole('link');
    await expect(tabs).toHaveCount(5);
    for (const tab of await tabs.all()) {
      const box = await tab.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/calm-polish-${width}-${colorScheme}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.protocol-card').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  const statuses = await page.evaluate(async () => {
    const r = indexedDB.open('protocol'); await new Promise<void>(resolve => { r.onsuccess = () => resolve(); });
    const q = r.result.transaction('entries').objectStore('entries').getAll();
    const rows = await new Promise<{status: string}[]>(resolve => { q.onsuccess = () => resolve(q.result); }); r.result.close(); return rows.map(x => x.status);
  });
  expect(statuses).toEqual(['planned', 'planned', 'planned']);
  await page.context().close();
});
