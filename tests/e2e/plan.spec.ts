import { expect, test } from '@playwright/test';
import { device } from './helpers';

test('medicine stock: the count in «План», «вистачить на» there and a notice on «День» when it runs low (D69)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/plan');
  await page.getByRole('button', { name: /^Редагувати: Вітамін D/ }).click();
  await page.getByRole('textbox', { name: 'Залишилось, шт' }).fill('4');
  await page.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.getByText(/вистачить на ~4 дн\./)).toBeVisible();
  await page.goto('./#/');
  await expect(page.getByText('Вітамін D — вистачить на ~4 дн. Час купити.')).toBeVisible();
  await page.getByRole('button', { name: 'Оновити залишок' }).click();
  await expect(page).toHaveURL(/#\/plan$/);
});
