import { expect, test } from '@playwright/test';
import { device, syncOn } from './helpers';
import { t } from '../../src/i18n/uk';

test('an opted-in vault stops a legacy client before cursor/data changes and explains that an upgrade is required', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const request = page.waitForRequest(r => /\/v1\/vaults\/[a-f0-9]{32}\/records\?/.test(r.url()));
  await syncOn(page);
  const first = await request;
  expect(new URL(first.url()).searchParams.get('protocol')).toBe('1');
  const root = first.url().split('/records')[0]!;
  const headers = { Authorization: first.headers().authorization! };
  const before = await (await page.request.get(`${root}/records?since=0&protocol=2`, { headers })).json();
  const cursor = () => page.evaluate(async () => {
    const req = indexedDB.open('protocol'); await new Promise<void>(r => { req.onsuccess = () => r(); });
    const read = req.result.transaction('meta').objectStore('meta').get('sync');
    const row = await new Promise<{ seq: number }>(r => { read.onsuccess = () => r(read.result); }); req.result.close(); return row.seq;
  });
  const seq = await cursor();
  const raised = await page.request.put(`${root}/write-protocol`, { headers, data: { minimum: 2, protocol: 2 } });
  expect(raised.status()).toBe(200);
  await page.getByRole('button', { name: t.sync.now, exact: true }).click();
  await expect(page.getByText(t.sync.errors.client_upgrade_required, { exact: true })).toBeVisible();
  expect(await cursor()).toBe(seq);
  expect(await (await page.request.get(`${root}/records?since=0&protocol=2`, { headers })).json()).toEqual(before);
  for (const width of [320, 1024]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/sync-upgrade-${width}-${colorScheme}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.context().close();
});
