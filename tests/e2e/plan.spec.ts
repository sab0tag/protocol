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

test('a skipped onboarding leaves the plan empty; the example is opened on purpose and taken out in one tap (D73)', async ({ browser }) => {
  const empty = await device(browser, 'skip');
  await empty.goto('./#/plan');
  await expect(empty.getByText('Вітамін D')).toHaveCount(0);
  await expect(empty.getByText(/Це приклад:/)).toHaveCount(0);

  const page = await device(browser); // «Подивитись на прикладі»
  await expect(page.getByText(/Це приклад:/)).toBeVisible();
  await page.getByRole('button', { name: 'Почати свій план' }).click();
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByRole('button', { name: 'Подивитись на прикладі' })).toBeVisible(); // nothing of the person's yet
  await page.goto('./#/plan');
  await expect(page.getByText('Вітамін D')).toHaveCount(0);
  await expect(page.getByText(/Це приклад:/)).toHaveCount(0);
});

test('the example comes with two invented weeks: «Прогрес» and the report’s «Головне» are filled; «Почати свій план» takes them too (D79)', async ({ browser }) => {
  const page = await device(browser, 'demo');
  await page.goto('./#/report');
  const main = page.getByRole('region', { name: 'Головне' });
  await expect(main).toContainText(/Ліки: прийнято 11 з 14 доз/);
  await expect(main).toContainText(/Непереносимість лактози — 4/);
  await expect(main).toContainText('Глюкоза натще');
  await expect(page.getByText(/«Здуття» — 4 з 4/)).toBeVisible();
  await page.goto('./#/progress');
  await expect(page.getByText(/Ще немає зважувань/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Почати свій план' }).first().click(); // D98: out of the example's database
  await expect(page).toHaveURL(/#\/welcome$/); // the own one, as it was — not onboarded yet
  await page.getByRole('button', { name: /^Пропустити/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(/Знайомство|Про себе/);
  await page.goto('./#/progress');
  await expect(page.getByText(/Ще немає зважувань/)).toBeVisible();
  await page.goto('./#/report');
  await expect(page.getByRole('region', { name: 'Головне' })).toHaveCount(0);
});

test('the example is a database of its own: the own records stay, «Подивитись приклад» is always in «Ще», no sync in it (D98)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/plan');
  await page.locator('section.rounded-2xl').filter({ has: page.getByRole('heading', { name: 'Призначення', exact: true }) }).getByRole('button', { name: 'Додати' }).click();
  await page.getByRole('dialog', { name: 'Призначення' }).getByRole('textbox', { name: 'Назва' }).fill('Мій препарат');
  await page.getByRole('dialog', { name: 'Призначення' }).getByRole('button', { name: 'Зберегти' }).click();
  await page.goto('./#/more');
  await page.getByRole('button', { name: /Подивитись на прикладі/ }).click(); // the own plan is not empty — still there
  await expect(page.getByText(/Це приклад:/)).toBeVisible();
  await page.goto('./#/plan');
  await expect(page.getByText('Вітамін D')).toBeVisible();
  await expect(page.getByText('Мій препарат')).toHaveCount(0); // not mixed
  await page.goto('./#/sync');
  await expect(page.getByText(/синхронізація в ньому вимкнена/)).toBeVisible();
  await page.getByRole('button', { name: 'Почати свій план' }).click();
  await page.goto('./#/plan');
  await expect(page.getByText('Мій препарат')).toBeVisible(); // the own, untouched
  await expect(page.getByText('Вітамін D')).toHaveCount(0);
});
