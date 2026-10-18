import { expect, test } from '@playwright/test';
import { device } from './helpers';

test('a diet of Наказ №931: «стіл 5» suggests ЩД to confirm, norms fill only empty targets, a doctor\'s target outside the norm is a question (D90)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/plan');
  await page.locator('section.rounded-2xl').filter({ has: page.getByRole('heading', { name: 'Обмеження', exact: true }) }).getByRole('button', { name: 'Додати' }).click();
  const form = page.getByRole('dialog', { name: 'Обмеження' });
  await form.getByRole('combobox', { name: 'Що це за обмеження' }).selectOption('diet');
  await form.getByRole('textbox', { name: 'Дієта або номер столу' }).fill('стіл 5');
  await expect(form.getByText('Стіл №5 тепер — ЩД. Підтвердіть, що лікар призначив саме це.')).toBeVisible();
  await form.getByRole('button', { name: /^ЩД — / }).click();
  await expect(form.getByText(/Норми \(довідково\): 2170–2480 ккал/)).toBeVisible();
  await expect(form.getByText(/ще не перевірені дієтологом/)).toBeVisible();
  await form.getByRole('checkbox', { name: /Заповнити порожні цілі/ }).check();
  await form.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.getByText(/^ЩД — Варіант дієти/)).toBeVisible();
  await expect(page.getByText('не перевірено дієтологом')).toBeVisible();
  await expect(page.getByText(/2325 ккал/)).toBeVisible(); // the middle of the norm, into an empty target

  await page.getByRole('button', { name: 'Редагувати', exact: true }).click(); // the targets
  await page.getByRole('dialog').getByRole('textbox', { name: 'Калорії, ккал' }).fill('1800');
  await page.getByRole('dialog').getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.getByText('Калорії у цілях — 1800, а норма ЩД — 2170–2480. Питання до лікаря.')).toBeVisible();
  await page.goto('./#/report');
  await expect(page.getByRole('region', { name: 'Головне' })).toContainText('Питання до лікаря');
});
