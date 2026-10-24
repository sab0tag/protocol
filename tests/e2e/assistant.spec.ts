import { expect, test } from '@playwright/test';
import { device, toast } from './helpers';

test('the assistant: the code answers «що добрати», the model the rest — a food failing the plan is never shown, medicines get the app’s words, a danger sign the 103 card (D117)', async ({ browser }) => {
  const page = await device(browser); // the example plan: lactose, glycemia, oxalate; Вітамін D; no sync — the device token
  let calls = 0, sent: { text: string; names: string[]; context: { day: { kcal: number } } } | undefined;
  await page.route('**/concierge/chat', async (r) => {
    calls++; sent = r.request().postDataJSON();
    const medicine = /метформін/iu.test(sent!.text);
    await r.fulfill({ json: medicine ? { topic: 'medicine', text: 'Пийте як хочете.', items: [] }
      : { topic: 'food', text: 'З того, що є, вийде вечеря: гречка з яйцем.', items: [{ name: 'Яйце варене', grams: 110 }, { name: 'Молоко 2,5 %', grams: 200 }, { name: 'Гречка варена', grams: 150 }] } });
  });
  await page.goto('./#/');
  await page.getByRole('link', { name: 'Помічник — запитати, що з’їсти' }).click();
  await expect(page.getByRole('heading', { name: 'Помічник' })).toBeVisible();
  await expect(page.getByText(/Сьогодні: калорій 0 з 2100 ккал/)).toBeVisible(); // the code's numbers

  await page.getByRole('button', { name: 'Що добрати до вечора?' }).click(); // the code answers — no model
  await expect(page.getByText('Сьогодні ще нічого не записано')).toBeVisible();
  expect(calls).toBe(0);

  const input = page.getByRole('textbox', { name: 'Питання помічнику' });
  await input.fill('у мене вдома лише яйця і гречка');
  await page.getByRole('button', { name: 'Надіслати' }).click();
  await page.getByRole('button', { name: 'Дозволити й запитати' }).click(); // once
  await expect(page.getByText('З того, що є, вийде вечеря')).toBeVisible();
  expect(sent?.names).toContain('Гречка варена');
  await expect(page.locator('[data-suggestion]')).toHaveCount(2);
  await expect(page.locator('[data-suggestion="Молоко 2,5 %"]')).toHaveCount(0); // lactose in the plan — never offered
  await expect(page.locator('[data-suggestion="Яйце варене"]')).toContainText(/≈ \d+ ккал · білка \d+ г/); // counted by the code
  await page.locator('[data-suggestion="Яйце варене"]').getByRole('button', { name: 'У план на вечір' }).click();
  await expect(toast(page)).toContainText('Яйце варене — у плані на вечір');

  await input.fill('чи можна пити метформін з кавою?');
  await page.getByRole('button', { name: 'Надіслати' }).click();
  await expect(page.getByText(/Про ліки — дозу, пропуск.*запитайте лікаря або фармацевта/)).toBeVisible();
  await expect(page.getByText('Пийте як хочете.')).toHaveCount(0); // the model's words on medicines are never shown

  const before = calls;
  await input.fill('дуже болить у грудях');
  await page.getByRole('button', { name: 'Надіслати' }).click();
  await expect(page.getByText(/103/).first()).toBeVisible();
  expect(calls).toBe(before); // a danger sign never reaches the model
});
