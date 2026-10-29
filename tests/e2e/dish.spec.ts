import { expect, test } from '@playwright/test';
import { device, toast } from './helpers';

test('a dish of one’s own described in words → ingredients with grams and КБЖУ, corrected, saved → found in «Записати їжу» (D110)', async ({ browser }) => {
  const page = await device(browser, 'skip', { sw: false }); // no sync — the device token
  let auth = '', sent: { text: string; foods: string[] } | undefined;
  await page.context().route('**/dish', async (r) => {
    auth = r.request().headers().authorization ?? ''; sent = r.request().postDataJSON();
    await r.fulfill({ json: { readable: true, name: 'Лаваш-рол з томленою свининою', portions: 1, note: 'Жирність шиї оцінено грубо', items: [
      { said: 'тонкий вірменський лаваш', base: 'Лаваш', grams: 70, amountSaid: false, kcal: 275, protein: 9, fat: 1.2, carbs: 56 },
      { said: 'свиняча шия довгого томлення', base: '', grams: 100, amountSaid: false, kcal: 320, protein: 24, fat: 25, carbs: 0 },
      { said: 'сир сулугуні', base: '', grams: 40, amountSaid: false, kcal: 290, protein: 20, fat: 23, carbs: 0.5 },
      { said: 'грецький йогурт', base: 'Йогурт грецький 2 %', grams: 40, amountSaid: false, kcal: 73, protein: 9, fat: 2, carbs: 4 },
      { said: 'кінза', base: '', grams: 5, amountSaid: false, kcal: 23, protein: 2.1, fat: 0.5, carbs: 3.7 }] } });
  });
  await page.goto('./#/meal/new');
  await page.getByRole('searchbox').fill('лаваш рол зі свининою');
  await page.getByRole('link', { name: 'Своя страва? Розкласти на інгредієнти' }).click();
  const box = page.getByRole('region', { name: 'Розкласти свою страву' });
  await expect(box.getByRole('textbox', { name: 'Опис страви' })).toHaveValue('лаваш рол зі свининою');
  await box.getByRole('textbox', { name: 'Опис страви' }).fill('лаваш рол: лаваш, томлена свиняча шия, сулугуні, грецький йогурт, кінза');
  await box.getByRole('button', { name: 'Розкласти на інгредієнти' }).click();
  await box.getByRole('button', { name: 'Дозволити й розкласти' }).click();
  await expect(box.locator('[data-ingredient]')).toHaveCount(5);
  expect(auth).toMatch(/^Device /);
  expect(sent?.foods).toContain('Йогурт грецький 2 %'); // the base's names go along
  await expect(box.locator('[data-ingredient="Лаваш"]')).toContainText('з бази');
  await expect(box.locator('[data-ingredient="Свиняча шия довгого томлення"]')).toContainText('оцінка ІІ — не з бази');
  await expect(box.locator('[data-ingredient="Свиняча шия довгого томлення"]')).toContainText('320 ккал · Б 24 · Ж 25 · В 0');
  await box.getByRole('spinbutton', { name: 'Грами: Свиняча шия довгого томлення' }).fill('120'); // more meat than guessed
  await expect(box.locator('[data-ingredient="Свиняча шия довгого томлення"]')).toContainText('384 ккал');
  await box.getByRole('button', { name: 'Прибрати: Кінза' }).click();
  await expect(box).toContainText(/Уся страва: 270 г/);
  await box.getByRole('button', { name: 'Зберегти як страву' }).click();
  await expect(toast(page)).toContainText('Страву «Лаваш-рол з томленою свининою» збережено');
  await page.goto('./#/meal/new');
  await page.getByRole('searchbox').fill('лаваш-рол');
  await expect(page.locator('[data-item="Лаваш-рол з томленою свининою"]')).toBeVisible();
});
