import { expect, test } from '@playwright/test';
import { device, toast } from './helpers';

const dish = (name: string) => ({ readable: true, name, portions: 1, note: '', items: [
  { said: 'Кабачок тушкований', base: '', grams: 150, amountSaid: true, kcal: 20, protein: 1, fat: 0.3, carbs: 3, tags: [], allergens: [] },
] });

test('one text request → editable list, selected dishes saved together and found after reload', async ({ browser }) => {
  const page = await device(browser, 'skip');
  let calls = 0;
  await page.route('**/dish-list', async (r) => { calls++; expect(r.request().postDataJSON().text).toContain('Суп'); await r.fulfill({ json: { dishes: [dish('Омлет тест'), dish('Суп тест')], note: '' } }); });
  await page.goto('./#/dishes');
  await page.getByText('Імпорт та експорт списку страв', { exact: true }).click();
  const box = page.getByRole('region', { name: 'Імпорт списку страв' });
  await box.getByRole('textbox', { name: 'Список страв', exact: true }).fill('Омлет: яйце 50 г, кабачок 150 г\n\nСуп: індичка 100 г');
  await box.getByRole('button', { name: 'Розібрати список', exact: true }).click();
  expect(calls).toBe(0);
  await box.getByRole('button', { name: 'Дозволити й розібрати список' }).click();
  await expect(box.getByRole('checkbox')).toHaveCount(2);
  expect(calls).toBe(1);
  await box.getByRole('spinbutton', { name: 'Грами: Омлет тест: Кабачок тушкований' }).fill('200');
  await box.getByRole('button', { name: 'Зберегти вибрані (2)' }).click();
  await expect(toast(page)).toContainText('Збережено страв: 2');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Назва', exact: true }).filter({ visible: true })).toHaveCount(2);
  await page.goto('./#/meal/new');
  await page.getByRole('searchbox').fill('Омлет тест');
  await expect(page.locator('[data-item="Омлет тест"]')).toBeVisible();
});

test('JSON file is local; duplicates blocked, invalid imports preserve existing dishes; export round trip', async ({ browser }) => {
  const page = await device(browser, 'skip');
  let ai = 0;
  await page.route('**/dish-list', async (r) => { ai++; await r.abort(); });
  await page.goto('./#/dishes');
  await page.getByText('Імпорт та експорт списку страв', { exact: true }).click();
  const box = page.getByRole('region', { name: 'Імпорт списку страв' });
  const file = (rows: unknown[]) => box.getByLabel('Файл зі списком страв').setInputFiles({ name: 'dishes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'protocol-dishes', version: 1, dishes: rows })) });
  await file([dish('Омлет файл'), dish('Суп файл')]);
  await expect(box.getByRole('checkbox')).toHaveCount(2);
  await box.getByRole('textbox', { name: 'Назва страви', exact: true }).nth(1).fill('ОМЛЕТ ФАЙЛ');
  await expect(box.getByRole('button', { name: 'Зберегти вибрані (2)' })).toBeDisabled();
  await box.getByRole('textbox', { name: 'Назва страви', exact: true }).nth(1).fill('Суп файл');
  await page.screenshot({ path: 'test-results/dish-list-preview.png', fullPage: true });
  await box.getByRole('button', { name: 'Зберегти вибрані (2)' }).click();
  await expect(toast(page)).toContainText('Збережено страв: 2');
  await file([dish('Омлет файл')]);
  await expect(box.getByRole('checkbox')).not.toBeChecked();
  await box.getByRole('button', { name: 'Скасувати імпорт' }).click();
  await file([dish('Ще одна'), { ...dish('Погана'), portions: 0 }]);
  await expect(box.getByRole('alert')).toContainText('Страва 2');
  const dl = page.waitForEvent('download');
  await box.getByRole('button', { name: 'Експорт JSON', exact: true }).click();
  expect((await dl).suggestedFilename()).toBe('my-dishes.json');
  expect(ai).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Назва', exact: true }).filter({ visible: true })).toHaveCount(2);
});
