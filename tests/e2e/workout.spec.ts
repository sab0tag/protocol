import { expect, test } from '@playwright/test';
import { device, toast } from './helpers';

test('kettlebell library: a card with two poses, an exercise replaced and one added; the next workout keeps the own set (D60)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/workout');
  await page.getByRole('button', { name: 'Як виконувати: Гоблет-присід' }).click();
  const card = page.getByRole('dialog', { name: 'Гоблет-присід' });
  await expect(card.getByRole('img', { name: 'Початок' })).toBeVisible();
  await expect(card.getByRole('img', { name: 'Рух' })).toBeVisible();
  await expect(card).toContainText('Амплітуда і напрям');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Замінити: Гоблет-присід' }).click();
  await page.getByRole('button', { name: /^Зворотний випад/ }).click();
  await page.getByRole('dialog', { name: /^Зворотний випад/ }).getByRole('button', { name: 'Замінити на цю' }).click();
  await expect(page.getByRole('button', { name: /^Як виконувати: Зворотний випад/ })).toBeVisible();

  await page.getByRole('button', { name: 'Додати вправу' }).click();
  await page.getByRole('button', { name: 'Складний', exact: true }).click();
  await page.getByRole('button', { name: /^Турецький підйом/ }).click();
  await expect(page.getByRole('dialog', { name: 'Турецький підйом' })).toContainText('Освоюйте з тренером');
  await page.getByRole('dialog', { name: 'Турецький підйом' }).getByRole('button', { name: 'Додати в тренування' }).click();
  await expect(page.getByRole('button', { name: /^Як виконувати: Турецький підйом/ })).toBeVisible();

  await page.getByRole('button', { name: 'Записати тренування' }).click();
  await expect(toast(page)).toHaveText(/Тренування записано/);
  await page.getByRole('button', { name: 'Наступний день' }).click();
  await page.getByRole('button', { name: 'Наступний день' }).click();
  await expect(page.getByRole('button', { name: /^Як виконувати: Зворотний випад/ })).toBeVisible(); // the own set, not the programme
  await expect(page.getByRole('button', { name: /^Як виконувати: Турецький підйом/ })).toBeVisible();
});
