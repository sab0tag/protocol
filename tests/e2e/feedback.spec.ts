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

test('a patient’s phrase: «чай з цукром, 2 куски хліба» — both found as said; an empty meal shows no zeros (D77, D78)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/meal/new');
  await expect(page.getByText('Цей прийом')).toHaveCount(0);
  await page.getByPlaceholder('Напр.: 2 яйця, кава').fill('чай з цукром, 2 куски хліба');
  const found = page.locator('section, div').filter({ hasText: /^Розпізнано/ }).first();
  await expect(found).toContainText('Чай з цукром');
  await expect(found).not.toContainText('без цукру');
  await expect(found).toContainText('Білий хліб (батон) · 2 скибки'); // D81: the everyday kind…
  await found.getByRole('button', { name: 'Хліб житній' }).click(); // …another in one tap
  await expect(found).toContainText('Хліб житній · 2 скибки');
  await page.getByRole('button', { name: 'Додати 2' }).click();
  await expect(page.getByText('Цей прийом')).toBeVisible();
  // the example plan has «порушена глікемія»: the added sugar is said, and for an eaten meal — as a hint for next time
  await expect(page.locator('section[aria-live]', { hasText: 'Перевірка за планом лікаря' })).toContainText('Доданий цукор');
});

test('«Ще» in groups; the exercise library is inside «Тренування»; reminders without sync offer to turn it on (D78)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/more');
  for (const g of ['Їжа', 'Стан і тренування', 'Нагадування й пристрої', 'Про застосунок']) await expect(page.getByRole('region', { name: g })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Вправи з гирею' })).toHaveCount(0);
  await page.goto('./#/workout');
  await page.getByRole('link', { name: 'Вправи з гирею' }).click();
  await expect(page).toHaveURL(/#\/exercises$/);
  await page.goto('./#/reminders');
  await page.getByRole('button', { name: 'Увімкнути синхронізацію' }).click();
  await expect(page).toHaveURL(/#\/sync\?back=%2Freminders/);
});

test('the medicine button hides while the quick tiles are on screen; water stays (D82)', async ({ browser }) => {
  const page = await device(browser);
  const dock = page.getByRole('group', { name: 'Ліки й вода' });
  await expect(page.getByRole('navigation', { name: 'Швидко' })).toBeInViewport();
  await expect(dock.getByRole('button', { name: /Додати 250 мл води/ })).toBeVisible();
  await expect(dock.getByRole('button', { name: /^Відмітити прийнятим|^Ліки на сьогодні/ })).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 600 }); // a small phone
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); // the tiles go off the top
  await expect(dock.getByRole('button', { name: /^Відмітити прийнятим: Вітамін D/ })).toBeVisible();
});

test('a word alone: the list line says what a tap adds; a cooked food has no «Як приготовано» (D88)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/meal/new');
  await page.getByPlaceholder('Напр.: 2 яйця, кава').fill('гречка');
  const first = page.locator('ul button[data-item]').first();
  await expect(first).toContainText('Гречка варена');
  await expect(first).toContainText('1 порція ≈ 200 г'); // not «1 ст. л. ≈ 25 г»
  await first.click();
  await expect(page.getByText('Гречка варена')).toBeVisible();
  await expect(page.getByLabel('Як приготовано')).toHaveCount(0);
});
