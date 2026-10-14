import { expect, test } from '@playwright/test';
import { device, toast } from './helpers';

test('records from a link: water with undo, the medicine (or a word why not), «Мені погано» opens (D66)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/do/water?ml=500');
  await expect(toast(page)).toContainText('+500 мл води');
  const water = page.getByRole('group', { name: 'Ліки й вода' }).getByRole('button', { name: /Додати 250 мл води/ });
  await expect(water).toHaveAttribute('aria-label', /зараз 500 з/);
  await toast(page).getByRole('button', { name: 'Скасувати' }).click();
  await expect(water).toHaveAttribute('aria-label', /зараз 0 з/);

  await page.goto('./#/do/med');
  await expect(toast(page)).toContainText('Вітамін D'); // marked now, or «час минув — відмітьте на «Дні»», by the clock
  await expect(page).toHaveURL(/#\/$/);

  await page.goto('./#/do/symptom');
  await expect(page.getByRole('dialog', { name: 'Що відчуваєте?' })).toBeVisible();

  await page.goto('./#/quick');
  await expect(page.getByText(/#\/do\/water$/)).toBeVisible();
});

test('«Що заважало»: one tap and a few words, listed newest first (D67)', async ({ browser }) => {
  const page = await device(browser);
  await page.getByRole('button', { name: 'Щось заважало? Запишіть' }).click();
  await page.getByRole('button', { name: 'Не записав — надто клопітно' }).click();
  await page.getByRole('textbox', { name: /^Кілька слів/ }).fill('вечеря в гостях');
  await page.getByRole('button', { name: 'Записати', exact: true }).click();
  await expect(toast(page)).toContainText('Записано — дякую');
  await expect(page.getByRole('region', { name: 'Записане' })).toContainText('Не записав — надто клопітно — вечеря в гостях');
});
