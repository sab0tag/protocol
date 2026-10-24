import { expect, test } from '@playwright/test';
import { device, toast } from './helpers';

test('«за потреби» with a daily limit: «Прийняв зараз», «сьогодні N з M», at the limit the doctor’s words first, the report shows the day over it (D118)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.evaluate(async () => { // a plan with Парацетамол «не більше 2 на добу»
    const req = indexedDB.open('protocol'); await new Promise((r) => { req.onsuccess = r; });
    const tx = req.result.transaction('plan', 'readwrite'); const store = tx.objectStore('plan'); const get = store.get('main');
    await new Promise((r) => { get.onsuccess = r; });
    store.put({ ...get.result, prescriptions: [{ id: 'para', kind: 'medication', title: 'Парацетамол', dose: '500 мг', asNeeded: true, maxPerDay: 2, source: 'Лікар' }] });
    await new Promise((r) => { tx.oncomplete = r; }); req.result.close();
  });
  await page.reload();
  const card = page.getByRole('region', { name: 'За потреби' });
  await expect(card).toContainText('сьогодні 0 з 2');
  const take = card.getByRole('button', { name: 'Прийняв зараз' });
  await take.click(); await expect(toast(page)).toContainText('Парацетамол — прийнято');
  await take.click(); await expect(card).toContainText('сьогодні 2 з 2');
  await take.click(); // the third — the doctor's words first, nothing recorded yet
  await expect(card.getByRole('alert')).toContainText('Лікар указав: не більше 2 на добу. Сьогодні вже 2.');
  await expect(card).toContainText('сьогодні 2 з 2');
  await card.getByRole('button', { name: 'Все одно записати прийом' }).click(); // it was taken — the record is the truth
  await expect(card).toContainText('сьогодні 3 з 2');
  await page.goto('./#/report');
  await expect(page.getByText(/Парацетамол — за потреби: 3 раз\(и\) за 1 дн\./)).toBeVisible();
  await expect(page.getByText(/понад «не більше 2 на добу»/)).toBeVisible();
});
