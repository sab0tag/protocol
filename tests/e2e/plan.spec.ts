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

test('«Тиждень»: the numbers, what went well, and one goal the person picks — shown on «День» (D72)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/week');
  await expect(page.getByRole('heading', { name: 'Тиждень', level: 1 })).toBeVisible();
  const goal = page.getByRole('region', { name: 'Ціль на тиждень' });
  await goal.getByRole('button', { name: 'Обрати ціль' }).click();
  await goal.getByRole('button', { name: 'Тренування — 3 на тиждень' }).click();
  await goal.getByRole('button', { name: 'Зберегти' }).click();
  await expect(goal).toContainText('Тренування — 3 на тиждень');
  await page.goto('./#/');
  await expect(page.getByRole('button', { name: /Ціль тижня:\s*Тренування — 3 на тиждень/ })).toBeVisible();
});
