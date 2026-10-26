import { expect, test } from '@playwright/test';
import { device, kyivOffset, seed, syncOn, toast, ymd } from './helpers';

test('a 2-day menu (model stubbed): checked by the plan, a line added to one meal, accepted with undo, a meal confirmed by ticks, then «Що купити»', async ({ browser }) => {
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
  await page.getByRole('button', { name: 'Дозволити й скласти' }).click(); // consent and compose in one tap
  await expect(page.getByText('Разом за день')).toHaveCount(2);
  expect(asked[1]!.avoid).toContain('Вінегрет');
  await expect(page.getByText(/Багато оксалатів — замінено/)).toBeVisible(); // the example plan: no beet

  await page.getByRole('button', { name: /^Прийняти в план/ }).click();
  await expect(toast(page)).toContainText('Меню на 2 дні в плані');
  await expect(page.getByText('Сніданок')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Сніданок, Заплановано/ })).toBeVisible();
  await expect(page.getByText('Меню · не підтверджено')).toHaveCount(0);
  await toast(page).getByRole('button', { name: 'Скасувати' }).click();
  await expect(page.getByText('Сніданок')).toHaveCount(0);

  await page.goto('./#/menu');
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: 'Скласти меню' }).click();
  await expect(page.getByText('Разом за день')).toHaveCount(2);
  // D54: an emptied meal stays, and a line can be added to that very meal
  await page.getByRole('button', { name: /^Прибрати: Яйце варене/ }).first().click();
  await expect(page.getByText(/^Порожньо/)).toBeVisible();
  await page.getByRole('button', { name: 'Додати в «Сніданок»' }).first().click();
  await page.getByRole('searchbox', { name: /^Продукт, страва/ }).fill('кефір');
  await page.getByRole('button', { name: /^Кефір 2,5 %/ }).first().click();
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByText(/^Порожньо/)).toHaveCount(0);
  await page.getByRole('button', { name: /^Прийняти в план/ }).click();
  await expect(toast(page)).toContainText('Меню на 2 дні в плані');
  // D55: a planned meal becomes a fact by ticks — nothing ticked beforehand, the time asked, an amount corrected here
  await page.getByRole('button', { name: /^Обід, Заплановано/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Підтвердити: Обід' });
  const save = sheet.getByRole('button', { name: 'Позначте, що з’їли' });
  await expect(save).toBeDisabled();
  await sheet.getByRole('checkbox').first().check();
  await expect(sheet.getByRole('button', { name: 'Оберіть, коли' })).toBeDisabled(); // tomorrow: no «Щойно», nothing assumed
  await sheet.getByRole('spinbutton').first().fill('0.5');
  await expect(sheet.getByText(/0,5 порції .* за планом [0-9,]+ порц/).first()).toBeVisible();
  await sheet.getByRole('button', { name: 'Час не пам’ятаю' }).click();
  await page.screenshot({ path: 'test-results/meal-confirm.png' });
  await sheet.getByRole('button', { name: 'Записати вибране (1)' }).click();
  await expect(toast(page)).toContainText('Обід — відмічено, час невідомий');
  await expect(page.getByRole('button', { name: /^Обід, Виконано, час невідомий/ })).toBeVisible();
  const tomorrow = ymd(new Date(Date.now() + 86_400_000));
  await page.goto(`./#/shopping?from=${tomorrow}&to=${ymd(new Date(Date.now() + 2 * 86_400_000))}`);
  await expect(page.getByText('Яйце куряче')).toBeVisible();
  await expect(page.getByText(/^\d+ шт$/).first()).toBeVisible();
});

test('a menu made but not accepted comes back after the page reloads (a locked phone); gone once accepted (D87)', async ({ browser }) => {
  const page = await device(browser);
  await syncOn(page);
  await page.route('**/menu', (r) => r.fulfill({ json: { tips: [], meals: [
    { title: 'Сніданок', time: '08:00', items: [{ name: 'Яйце варене', grams: 100, count: 2 }] }] } }));
  await page.goto('./#/menu');
  await page.getByLabel('Побажання (необов’язково)').fill('легка вечеря');
  await page.getByRole('button', { name: 'Скласти меню' }).click();
  await page.getByRole('button', { name: 'Дозволити й скласти' }).click();
  await expect(page.getByText('Разом за день')).toHaveCount(1);
  await page.reload(); // what an unlock may do: iOS dropped the page, or a new version took over
  await expect(page.getByText('Разом за день')).toHaveCount(1);
  await expect(page.getByText('Яйце варене')).toBeVisible();
  await expect(page.getByLabel('Побажання (необов’язково)')).toHaveValue('легка вечеря');
  await page.getByRole('button', { name: /^Прийняти в план/ }).click();
  await expect(toast(page)).toContainText('в плані');
  await page.goto('./#/menu');
  await expect(page.getByText('Разом за день')).toHaveCount(0); // accepted — nothing to bring back
});

test('a meal 45 minutes ahead does not preselect «Щойно» for confirmation', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const now = new Date();
  const planned = new Date(now.getTime() + 45 * 60_000);
  test.skip(ymd(planned) !== ymd(now), 'needs a future meal on the same day');
  const time = `${String(planned.getHours()).padStart(2, '0')}:${String(planned.getMinutes()).padStart(2, '0')}`;
  await seed(page, [{
    store: 'entries',
    value: { id: 'future-confirmation', at: `${ymd(planned)}T${time}:00${kyivOffset(planned)}`, kind: 'meal', status: 'planned', title: 'Обід',
      items: [{ foodId: 'kefir', name: 'Кефір 2,5 %', grams: 250 }] },
  }]);

  const rhythm = page.getByRole('region', { name: 'Ритм дня' });
  await rhythm.getByRole('button', { name: /^Обід, Заплановано/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Підтвердити: Обід' });
  await expect(sheet.getByRole('button', { name: /^Щойно/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(sheet.getByRole('button', { name: 'Позначте, що з’їли' })).toBeDisabled();
});
