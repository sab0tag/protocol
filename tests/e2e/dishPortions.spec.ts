import { expect, test } from '@playwright/test';
import { device, toast } from './helpers';

/** Regression for iPhone-sized editing: deleting the old yield must not corrupt
 * ingredient weights or saved per-portion nutrition (PR #140). */
test('dish yield 2 → blank → 1, invalid blur, and saved per-portion ingredients', async ({ browser }) => {
  const page = await device(browser, 'skip', { sw: false });
  await page.context().route('**/dish', async (route) => {
    await route.fulfill({ json: {
      readable: true, name: 'Рис зі свининою', portions: 2, note: '',
      items: [
        { said: 'томлена свинина', base: '', grams: 275, amountSaid: true,
          kcal: 260, protein: 26, fat: 17, carbs: 0 },
        { said: 'рис варений', base: '', grams: 375, amountSaid: true,
          kcal: 130, protein: 3, fat: 0.3, carbs: 28 },
      ],
    } });
  });
  await page.goto('./#/meal/new');
  await page.getByRole('searchbox').fill('рис зі свининою');
  await page.getByRole('link', { name: 'Своя страва? Розкласти на інгредієнти' }).click();
  const editor = page.getByRole('region', { name: 'Розкласти свою страву' });
  await editor.getByRole('textbox', { name: 'Опис страви' }).fill('рис зі свининою, дві порції');
  await editor.getByRole('button', { name: 'Розкласти на інгредієнти' }).click();
  await editor.getByRole('button', { name: 'Дозволити й розкласти' }).click();

  const portions = editor.getByRole('textbox', { name: 'Скільки порцій у цьому описі' });
  const pork = editor.getByRole('spinbutton', { name: 'Грами: Томлена свинина' });
  const rice = editor.getByRole('spinbutton', { name: 'Грами: Рис варений' });
  await expect(portions).toHaveValue('2');
  await expect(pork).toHaveValue('275');
  await expect(rice).toHaveValue('375');

  // On a mobile keyboard the field is briefly empty between deleting 2 and typing 1.
  await portions.fill('');
  await expect(portions).toHaveValue('');
  await expect(pork).toHaveValue('275');
  await portions.fill('1');
  await portions.blur();
  await expect(portions).toHaveValue('1');
  await expect(pork).toHaveValue('137.5');
  await expect(rice).toHaveValue('187.5');

  // An invalid edit must restore the last valid yield without changing weights.
  await portions.fill('0');
  await portions.blur();
  await expect(portions).toHaveValue('1');
  await expect(pork).toHaveValue('137.5');

  // Repeated changes must not introduce rounding drift.
  await portions.fill('2');
  await portions.blur();
  await expect(pork).toHaveValue('275');
  await expect(rice).toHaveValue('375');
  await portions.fill('1');
  await portions.blur();
  await expect(pork).toHaveValue('137.5');
  await expect(rice).toHaveValue('187.5');

  await editor.getByRole('button', { name: 'Зберегти як страву' }).click();
  await expect(toast(page)).toContainText('Рис зі свининою');
  const recipe = await page.evaluate(async () => {
    const request = indexedDB.open('protocol');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('recipes', 'readonly');
    const read = transaction.objectStore('recipes').getAll();
    const recipes = await new Promise<Array<{ name: string; items: Array<{ grams: number; manual?: { kcal: number } }> }>>((resolve, reject) => {
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    database.close();
    return recipes.find((item) => item.name === 'Рис зі свининою');
  });
  expect(recipe?.items.map((item) => item.grams)).toEqual([137.5, 187.5]);
  expect(recipe?.items[0]?.manual?.kcal).toBeCloseTo(357.5);
  expect(recipe?.items[1]?.manual?.kcal).toBeCloseTo(243.75);
});
