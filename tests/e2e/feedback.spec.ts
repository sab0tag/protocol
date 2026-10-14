import { expect, test } from '@playwright/test';
import { device, ymd } from './helpers';

test('the menu says which day, and without sync offers to turn it on and comes back with the wish (D74)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/menu');
  await expect(page.getByRole('heading', { name: 'Меню на завтра', level: 1 })).toBeVisible();
  await page.getByLabel('На який день').fill(ymd(new Date()));
  await expect(page.getByRole('heading', { name: 'Меню на сьогодні', level: 1 })).toBeVisible();
  await page.getByLabel('Побажання (необов’язково)').fill('вечеря легка');
  await expect(page.getByRole('button', { name: 'Як учора' })).toBeVisible(); // works without the server
  await page.getByRole('button', { name: 'Увімкнути синхронізацію' }).click();
  await page.getByRole('button', { name: 'Увімкнути на цьому пристрої' }).click();
  await page.getByRole('button', { name: 'Код записав — увімкнути' }).click();
  await expect(page).toHaveURL(/#\/menu\?/);
  await expect(page.getByLabel('Побажання (необов’язково)')).toHaveValue('вечеря легка');
  await expect(page.getByRole('heading', { name: 'Меню на сьогодні', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скласти меню' })).toBeVisible();
});

test('every sheet has a visible ×; an empty «Як учора» offers the first meal; «Самопочуття» says it is saved (D74)', async ({ browser }) => {
  const page = await device(browser);
  await page.getByRole('button', { name: 'Як учора' }).click();
  const sheet = page.getByRole('dialog', { name: /учора/i });
  await expect(sheet.getByRole('button', { name: 'Записати перший прийом' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Закрити' }).click();
  await expect(sheet).toBeHidden();

  await page.goto('./#/wellbeing');
  await expect(page.getByText(/Зберігається одразу/)).toBeVisible();
  await page.getByRole('button', { name: 'Енергія: 4' }).click();
  await expect(page.getByText(/^Збережено о \d\d:\d\d$/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Нотатка' }).fill('спав погано');
  await page.getByRole('button', { name: 'Зберегти нотатку' }).click();
  await expect(page.getByRole('button', { name: 'Зберегти нотатку' })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Нотатка' })).toHaveValue('спав погано');
});
