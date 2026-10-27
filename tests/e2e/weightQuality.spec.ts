import { expect, test } from '@playwright/test';
import { device, seed, ymd, toast } from './helpers';
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
test('a decimal/unit outlier stays out of progress and reports; correction retains history', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [
    { store: 'weights', value: { date: day(14), kg: 100 } },
    { store: 'weights', value: { date: day(7), kg: 91 } },
    { store: 'weights', value: { date: day(0), kg: 9.1 } },
  ]);
  await page.goto('./#/progress');
  await expect(page.getByText('Вимірів на перевірці: 1.', { exact: false })).toBeVisible();
  const current = page.locator('dl').getByText('91', { exact: false }); await expect(current).toBeVisible();
  await page.goto('./#/report');
  await expect(page.getByText('Виміри ваги на перевірці: 1. До розрахунків не включені.', { exact: true })).toBeVisible();
  await page.goto('./#/progress');
  for (const width of [320, 1024]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    await expect(page.getByRole('figure', { name: 'Виміри ваги, кг', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.getByLabel('Дата', { exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(160);
    await page.screenshot({ path: `test-results/weight-review-${width}-${colorScheme}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: `Редагувати вимір: ${day(0)}`, exact: true }).click();
  const form = page.getByRole('form', { name: 'Редагувати вимір' });
  await form.getByLabel('Вага, кг').fill('90'); await form.getByRole('button', { name: 'Зберегти вимір', exact: true }).click();
  await expect(page.getByText('Вимірів на перевірці: 1.', { exact: false })).toHaveCount(0);
  await expect(page.locator('dl')).toContainText('90');
  const rows = await page.evaluate(async () => {
    const req = indexedDB.open('protocol'); await new Promise(r => { req.onsuccess = r; });
    const q = req.result.transaction('weights').objectStore('weights').getAll();
    const rows = await new Promise<{ kg: number; corrections?: { kg: number }[] }[]>(r => { q.onsuccess = () => r(q.result); }); req.result.close(); return rows;
  });
  expect(rows).toHaveLength(3); expect(rows.at(-1)).toMatchObject({ kg: 90, corrections: [{ kg: 9.1 }] });
  await page.reload(); await expect(page.locator('dl')).toContainText('90');
  await page.getByLabel('Вага, кг').fill('-1'); await page.getByRole('button', { name: 'Записати вагу', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('від 0,1 до 1000 кг');
  await page.context().close();
});
test('a person can explicitly verify a large real change and undo deleting a measurement', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [{ store: 'weights', value: { date: day(7), kg: 100 } }, { store: 'weights', value: { date: day(0), kg: 60 } }]);
  await page.goto('./#/progress');
  await page.getByRole('button', { name: 'Значення правильне: 60 кг', exact: true }).click();
  await expect(page.getByText('Вимірів на перевірці:', { exact: false })).toHaveCount(0);
  await expect(page.locator('dl')).toContainText('60');
  await page.getByText('Історія вимірів', { exact: true }).click();
  await page.getByRole('button', { name: `Видалити вимір: ${day(0)}`, exact: true }).click();
  await expect(page.locator('dl')).toContainText('100');
  await toast(page).getByRole('button', { name: 'Скасувати', exact: true }).click();
  await expect(page.locator('dl')).toContainText('60');
  await page.reload(); await expect(page.locator('dl')).toContainText('60');
  await page.context().close();
});
