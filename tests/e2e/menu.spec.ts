import { expect, test } from '@playwright/test';
import { device, syncOn, toast, ymd } from './helpers';

test('a 2-day menu (model stubbed): checked by the plan, accepted with undo, then «Що купити»', async ({ browser }) => {
  const page = await device(browser);
  await syncOn(page);
  const asked: { date: string; avoid: string[] }[] = [];
  await page.route('**/menu', async (r) => {
    const body = r.request().postDataJSON() as { date: string; avoid: string[] };
    asked.push(body);
    await r.fulfill({ json: { tips: [`Порада на ${body.date}`], meals: [
      { title: 'Сніданок', time: '08:00', items: [{ name: 'Яйце варене', grams: 100, count: 2 }] },
      { title: 'Обід', time: '13:00', items: [{ name: asked.length === 1 ? 'Вінегрет' : 'Гречка з куркою', grams: 300, count: null }] },
    ] } });
  });
  await page.goto('./#/menu');
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: 'Скласти меню' }).click();
  await page.getByRole('button', { name: 'Дозволити й скласти' }).click();
  await page.getByRole('button', { name: 'Скласти меню' }).click();
  await expect(page.getByText('Разом за день')).toHaveCount(2);
  expect(asked[1]!.avoid).toContain('Вінегрет');
  await expect(page.getByText(/Багато оксалатів — замінено/)).toBeVisible(); // the example plan: no beet

  await page.getByRole('button', { name: /^Прийняти в план/ }).click();
  await expect(toast(page)).toContainText('Меню на 2 дні в плані');
  await expect(page.getByText('Сніданок')).toBeVisible();
  await toast(page).getByRole('button', { name: 'Скасувати' }).click();
  await expect(page.getByText('Сніданок')).toHaveCount(0);

  await page.goto('./#/menu');
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: 'Скласти меню' }).click();
  await expect(page.getByText('Разом за день')).toHaveCount(2);
  await page.getByRole('button', { name: /^Прийняти в план/ }).click();
  await expect(toast(page)).toContainText('Меню на 2 дні в плані');
  // D46: a tap on a planned meal shows what is in it, above the actions
  await page.getByRole('button', { name: /^Обід, Заплановано/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Обід' });
  await expect(sheet.getByText(/Гречка з куркою|Вінегрет/).first()).toBeVisible();
  await expect(sheet.getByText(/\d+ ккал · Б/)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Виконано' })).toBeVisible();
  await page.screenshot({ path: 'test-results/meal-preview.png' });
  await page.keyboard.press('Escape');
  const tomorrow = ymd(new Date(Date.now() + 86_400_000));
  await page.goto(`./#/shopping?from=${tomorrow}&to=${ymd(new Date(Date.now() + 2 * 86_400_000))}`);
  await expect(page.getByText('Яйце куряче')).toBeVisible();
  await expect(page.getByText(/^\d+ шт$/).first()).toBeVisible();
});
