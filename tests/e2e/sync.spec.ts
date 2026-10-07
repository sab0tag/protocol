import { expect, test } from '@playwright/test';
import { device, syncOn, toast } from './helpers';

test('two devices: a short pairing code connects the second; a meal and its deletion travel', async ({ browser }) => {
  const phone = await device(browser);
  await phone.goto('./#/meal/new');
  await phone.getByRole('searchbox').fill('2 варених яйця');
  await phone.locator('form ul button').first().click();
  await phone.getByRole('button', { name: 'Записати', exact: true }).click();
  await expect(toast(phone)).toContainText('записано');
  await syncOn(phone);

  await phone.getByRole('button', { name: 'Показати код для підключення' }).click();
  const pair = (await phone.locator('p.font-mono.text-4xl').innerText()).trim();
  expect(pair).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await expect(phone.getByRole('img', { name: 'QR-код для підключення' })).toBeVisible();

  const laptop = await device(browser);
  await laptop.goto('./#/sync');
  await laptop.getByRole('button', { name: 'У мене вже є код' }).click();
  await laptop.getByRole('textbox').fill(pair.toLowerCase());
  await laptop.getByRole('button', { name: 'Підключити' }).click();
  await expect(laptop.getByText('Яйце варене')).toBeVisible({ timeout: 20_000 });

  // the short code works once
  const third = await device(browser);
  await third.goto(`./#/sync?pair=${pair.replace('-', '')}`);
  await third.getByRole('button', { name: 'Підключити' }).click();
  await expect(third.getByRole('alert')).toContainText('Короткий код не знайдено');

  // deleted on the laptop → gone on the phone
  await laptop.getByText('Яйце варене').click();
  await laptop.getByRole('button', { name: 'Видалити' }).click();
  await expect(toast(laptop)).toContainText('Видалено');
  await laptop.goto('./#/sync');
  await laptop.getByRole('button', { name: 'Синхронізувати зараз' }).click();
  await laptop.waitForTimeout(1500);
  await phone.getByRole('button', { name: 'Синхронізувати зараз' }).click();
  await phone.waitForTimeout(1500);
  await phone.goto('./');
  await expect(phone.getByText('Яйце варене')).toHaveCount(0);
});
