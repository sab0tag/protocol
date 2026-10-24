import { expect, test, type Page } from '@playwright/test';
import { device, toast } from './helpers';

const withPlan = async (page: Page, rx: unknown) => {
  await page.evaluate(async (p) => {
    const req = indexedDB.open('protocol'); await new Promise((r) => { req.onsuccess = r; });
    const tx = req.result.transaction('plan', 'readwrite'); const store = tx.objectStore('plan'); const get = store.get('main');
    await new Promise((r) => { get.onsuccess = r; });
    store.put({ ...get.result, prescriptions: [p] });
    await new Promise((r) => { tx.oncomplete = r; }); req.result.close();
  }, rx);
  await page.reload();
};

test('«за потреби» with a limit in tablets: how much was taken, «сьогодні N з M табл.», the doctor’s words before going over, the report (D118, R01)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await withPlan(page, { id: 'para', kind: 'medication', title: 'Парацетамол', dose: '500 мг', asNeeded: true, source: 'Лікар',
    limit: { value: 2, unit: 'tablet', sourceText: 'не більше 2 табл. на добу', source: 'paper' } });
  const card = page.getByRole('region', { name: 'За потреби' });
  await expect(card).toContainText('сьогодні 0 з 2 табл.');
  const take = card.getByRole('button', { name: 'Прийняв зараз' });
  // a half and a whole: 1,5 of 2 — not rounded
  await take.click();
  await card.getByLabel('Кількість').fill('0,5');
  await card.getByRole('button', { name: 'Записати' }).dblclick(); // a double tap — one record
  await expect(toast(page)).toContainText('Парацетамол — прийнято');
  await expect(card).toContainText('сьогодні 0,5 з 2 табл.');
  await take.click();
  await card.getByRole('button', { name: 'Записати' }).click();
  await expect(card).toContainText('сьогодні 1,5 з 2 табл.');
  // 1 more would be 2,5 — the doctor's words first, nothing recorded yet
  await take.click();
  await card.getByRole('button', { name: 'Записати' }).click();
  await expect(card.getByRole('alert')).toContainText('Лікар указав: не більше 2 табл. на добу. Сьогодні вже 1,5 табл.');
  await expect(card).toContainText('сьогодні 1,5 з 2 табл.');
  await card.getByRole('button', { name: 'Все одно записати прийом' }).click(); // it was taken — the record is the truth
  await expect(card).toContainText('сьогодні 2,5 з 2 табл.');
  // the first record was 1 tablet, not a half: corrected — the count and the report follow
  await card.getByRole('button', { name: 'Виправити кількість: 0,5 табл.' }).click();
  await card.getByRole('textbox', { name: 'Кількість' }).fill('1');
  await card.getByRole('button', { name: 'Зберегти' }).click();
  await expect(card).toContainText('сьогодні 3 з 2 табл.');
  await page.goto('./#/report');
  await expect(page.getByText(/Парацетамол — за потреби: 3 раз\(и\) за 1 дн\./)).toBeVisible();
  await expect(page.getByText(/понад «не більше 2 табл\. на добу»/)).toBeVisible();
});

test('an old limit with no unit: counted as intakes, no remainder drawn, the plan asks for the unit (R01)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await withPlan(page, { id: 'ibu', kind: 'medication', title: 'Ібупрофен', dose: '200 мг', asNeeded: true, source: 'Лікар', maxPerDay: 3 });
  const card = page.getByRole('region', { name: 'За потреби' });
  await card.getByRole('button', { name: 'Прийняв зараз' }).click();
  await card.getByRole('button', { name: 'Записати' }).click();
  await expect(card).toContainText('сьогодні прийомів: 1');
  await expect(card).toContainText('Не вдалося зіставити одиниці з межею лікаря');
  await expect(card).not.toContainText('з 3');
  await page.goto('./#/plan');
  await page.getByRole('button', { name: /Ібупрофен/ }).first().click();
  await expect(page.getByText('Межу внесено без одиниці — вкажіть, у чому вона (таблетки, прийоми…)')).toBeVisible();
  await page.getByLabel('В чому межа').selectOption('intake');
  await page.getByRole('button', { name: 'Зберегти' }).click();
  await page.goto('./#/');
  await expect(card).toContainText('сьогодні 1 з 3 раз(и)');
});
