import { expect, test } from '@playwright/test';
import { expandLegacyPlan } from '../../src/domain/carePlans';
import { emptyPlan } from '../../src/data/seed.example';
import { device } from './helpers';
import { t } from '../../src/i18n/uk';

test('portable source-plan backup requires confirmation, retains its source and prevents silent old-format replacement', async ({ browser }) => {
  const page = await device(browser, 'skip'); await page.goto('./#/data');
  const plan = { ...emptyPlan(), id: 'main', onboardedAt: '2026-10-27', questions: ['Synthetic portable question'] };
  const expanded = expandLegacyPlan(plan, 'another-device');
  const file = { format: 'protocol-export', version: 3, exportedAt: '2026-10-27T12:00:00Z', plan,
    foods: [], entries: [], wellbeing: [], workouts: [], weights: [], labs: [], moduleEvents: [],
    sourcePlans: { v: 1, plans: expanded.plans, items: expanded.items, migrations: [{ id: 'legacy-main-v1', personId: 'another-device', at: '2026-10-27T12:00:00Z', legacySnapshot: expanded.legacySnapshot }] } };
  const upload = page.locator('input[type=file]');
  await upload.setInputFiles({ name: 'synthetic-v3.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(t.backup.sourcePlans(1));
  await expect(dialog).toContainText(t.backup.moduleHistory);
  const count = () => page.evaluate(async () => {
    const req = indexedDB.open('protocol'); await new Promise<void>(r => { req.onsuccess = () => r(); });
    const q = req.result.transaction('carePlans').objectStore('carePlans').count();
    const n = await new Promise<number>(r => { q.onsuccess = () => r(q.result); }); req.result.close(); return n;
  });
  expect(await count()).toBe(0); // picking a file is never activation/restore
  for (const width of [320, 1024]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    await dialog.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/plan-backup-${width}-${colorScheme}.png`, fullPage: true, animations: 'disabled' });
  }
  await dialog.getByRole('button', { name: t.backup.yes, exact: true }).click();
  await expect(page.getByRole('status')).toContainText(t.backup.restored); expect(await count()).toBe(1);
  const old = { ...file, version: 2, sourcePlans: undefined, plan: { ...plan, questions: ['Should not replace'] } };
  await upload.setInputFiles({ name: 'synthetic-v2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
  await dialog.getByRole('button', { name: t.backup.yes, exact: true }).click();
  await expect(page.getByRole('status')).toContainText('не містить окремих планів'); expect(await count()).toBe(1);
  await page.reload();
  const stored = await page.evaluate(async () => {
    const req = indexedDB.open('protocol'); await new Promise<void>(r => { req.onsuccess = () => r(); });
    const tx = req.result.transaction(['plan', 'carePlans', 'planMigrations']);
    const read = <T>(q: IDBRequest<T>) => new Promise<T>(r => { q.onsuccess = () => r(q.result); });
    const value = { plan: await read(tx.objectStore('plan').get('main')), normalized: await read(tx.objectStore('carePlans').getAll()), marker: await read(tx.objectStore('planMigrations').get('legacy-main-v1')) }; req.result.close(); return value;
  });
  expect(stored.plan.questions).toEqual(['Synthetic portable question']);
  expect(stored.normalized[0].personId).toBe('main'); expect(stored.normalized[0].id).toBe(expanded.plans[0]!.id);
  expect(stored.marker.legacySnapshot.personId).toBe('main');
  await page.context().close();
});
