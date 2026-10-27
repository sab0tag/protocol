import { expect, test } from '@playwright/test';
import { device } from './helpers';

test('a diet of Наказ №931: «стіл 5» suggests ЩД to confirm, its rules not set up said plainly, norms fill only empty targets after a preview and marked, a doctor\'s target outside the norm is a question (D90, R02)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/plan/constraints');
  await page.locator('section.rounded-2xl').filter({ has: page.getByRole('heading', { name: 'Дієта й обмеження', exact: true }) }).getByRole('button', { name: 'Додати' }).click();
  const form = page.getByRole('dialog', { name: 'Дієта й обмеження' });
  await form.getByRole('combobox', { name: 'Що це за обмеження' }).selectOption('diet');
  await form.getByRole('textbox', { name: 'Дієта або номер столу' }).fill('стіл 5');
  await expect(form.getByText('Стіл №5 тепер — ЩД. Підтвердіть, що лікар призначив саме це.')).toBeVisible();
  await form.getByRole('button', { name: /^ЩД — / }).click();
  await expect(form.getByText(/Норми \(довідково\): 2170–2480 ккал/)).toBeVisible();
  await expect(form.getByText(/Дієту збережено; автоматичну перевірку її правил ще не налаштовано/)).toBeVisible();
  await form.getByRole('checkbox', { name: /Заповнити порожні цілі/ }).check();
  await expect(form.getByText(/Буде вписано — середина довідкового діапазону.*2325 ккал/)).toBeVisible(); // a preview before it is written
  await form.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.getByText(/^ЩД — Варіант дієти/)).toBeVisible();
  await expect(page.getByText('не перевірено дієтологом', { exact: true })).toBeVisible();
  await expect(page.getByText(/автоматичну перевірку її правил ще не налаштовано/)).toBeVisible();
  // the meal check: no green «Підходить» as if the diet were checked
  await page.goto('./#/meal/new');
  await page.getByRole('searchbox').fill('гречка');
  await page.getByRole('button', { name: /^Гречка варена/ }).first().click();
  await expect(page.getByText('Зауважень немає — за налаштованими правилами')).toBeVisible();
  await expect(page.getByText(/ЩД: дієту збережено; автоматичну перевірку її правил ще не налаштовано/)).toBeVisible();
  await expect(page.getByText('Підходить', { exact: true })).toHaveCount(0);
  await page.goto('./#/plan/goals');
  await expect(page.getByText(/2325 ккал \(з довідника ЩД, не від лікаря\)/)).toBeVisible(); // the middle of the norm, into an empty target, marked

  await page.getByRole('button', { name: 'Редагувати', exact: true }).click(); // the targets
  await page.getByRole('dialog').getByRole('textbox', { name: 'Калорії, ккал' }).fill('1800');
  await page.getByRole('dialog').getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.getByText('Калорії у цілях — 1800, а норма ЩД — 2170–2480. Питання до лікаря.')).toBeVisible();
  await expect(page.getByText(/1800 ккал ·/)).toBeVisible(); // edited by the person — no longer «з довідника»
  await expect(page.getByText(/1800 ккал \(з довідника/)).toHaveCount(0);
  await page.goto('./#/report');
  await expect(page.getByRole('region', { name: 'Головне' })).toContainText('Питання до лікаря');
});
