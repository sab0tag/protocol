import { expect, test } from '@playwright/test';
import { device, seed } from './helpers';

test('repeat a past meal into a chosen future date without modifying the source', async ({ browser }) => {
  const page = await device(browser);
  const source = { id: 'synthetic-past-meal', at: '2026-10-20T10:40:00+03:00', kind: 'meal', status: 'done', title: 'Сніданок', items: [{ name: 'Вівсянка на воді', grams: 200 }] };
  await seed(page, [{ store: 'entries', value: source }]);
  await page.goto('./#/meal/new');
  await page.getByLabel('Дата нового прийому').fill('2026-11-05');
  await page.locator('[data-testid="recent-meal-add"]').first().click();
  await expect(page.getByLabel('Дата нового прийому')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /зберегти/i }).last()).toBeEnabled();
  const original = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('protocol'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const row = await new Promise<unknown>((resolve, reject) => {
      const r = db.transaction('entries').objectStore('entries').get('synthetic-past-meal');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    db.close(); return row;
  });
  expect(original).toEqual(source);
  await page.context().close();
});
