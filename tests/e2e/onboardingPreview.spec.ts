import { expect, test } from '@playwright/test';
import { t } from '../../src/i18n/uk';

for (const width of [320, 1024]) test(`onboarding explains the verified plan using an isolated synthetic preview at ${width}px`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' }); // counted AI calls must not pass the route via the worker
  const page = await context.newPage();
  let aiCalls = 0;
  await page.route('**/conclusion', route => { aiCalls++; return route.abort(); });
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.welcome.s0);
  const preview = page.getByRole('region', { name: t.welcome.preview.title, exact: true });
  await expect(preview).toContainText(t.welcome.preview.label);
  await expect(preview.getByRole('listitem')).toHaveCount(3);
  await expect(preview).toContainText(t.welcome.preview.verify);
  await expect(page.getByRole('button', { name: 'Фото висновку лікаря', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/onboarding-preview-${width}.png`, fullPage: true });
  await page.getByText('Інші способи почати').click(); await page.getByRole('button', { name: /^Пропустити/ }).click();
  await expect(page).toHaveURL(/#\/$/);
  const stored = await page.evaluate(async () => {
    const open = indexedDB.open('protocol');
    const db = await new Promise<IDBDatabase>(resolve => { open.onsuccess = () => resolve(open.result); });
    const tx = db.transaction(['plan', 'entries']);
    const plan = tx.objectStore('plan').get('main'), entries = tx.objectStore('entries').count();
    const result = await Promise.all([
      new Promise<{ prescriptions: unknown[]; constraints: unknown[] }>(resolve => { plan.onsuccess = () => resolve(plan.result); }),
      new Promise<number>(resolve => { entries.onsuccess = () => resolve(entries.result); }),
    ]);
    db.close(); return { prescriptions: result[0].prescriptions, constraints: result[0].constraints, entries: result[1] };
  });
  expect(stored).toEqual({ prescriptions: [], constraints: [], entries: 0 });
  expect(aiCalls).toBe(0);
  await context.close();
});
