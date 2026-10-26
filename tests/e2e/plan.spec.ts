import { expect, test } from '@playwright/test';
import { device, seed } from './helpers';

test('medicine stock: the count in «План», «вистачить на» there and a notice on «День» when it runs low (D69)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/plan/prescriptions');
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
  await empty.goto('./#/plan/prescriptions');
  await expect(empty.getByText('Вітамін D')).toHaveCount(0);
  await expect(empty.getByText(/Це приклад:/)).toHaveCount(0);

  const page = await device(browser); // «Подивитись на прикладі»
  await expect(page.getByText(/Це приклад:/)).toBeVisible();
  await page.getByRole('button', { name: 'Почати свій план' }).click();
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByRole('button', { name: 'Подивитись на прикладі' })).toBeVisible(); // nothing of the person's yet
  await page.goto('./#/plan/prescriptions');
  await expect(page.getByText('Вітамін D')).toHaveCount(0);
  await expect(page.getByText(/Це приклад:/)).toHaveCount(0);
});

test('the example comes with two invented weeks: «Прогрес» and the report’s «Головне» are filled; «Почати свій план» takes them too (D79)', async ({ browser }) => {
  const page = await device(browser, 'demo');
  await page.goto('./#/report');
  const main = page.getByRole('region', { name: 'Головне' });
  await expect(main).toContainText(/Ліки: відмічено прийнятими 11 з 14 доз у дні з записами/);
  await expect(main).toContainText(/Непереносимість лактози — 4/);
  await expect(main).toContainText('Глюкоза натще');
  await expect(page.getByText(/«Здуття» — 4 з 4/)).toBeVisible();
  await page.goto('./#/progress');
  await expect(page.getByText(/Ще немає зважувань/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Повернутися до своїх даних' }).first().click(); // D98: out of the example's database
  await expect(page).toHaveURL(/#\/welcome$/); // the own one, as it was — not onboarded yet
  await page.getByRole('button', { name: /^Пропустити/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(/Знайомство|Про себе|Сфотографуйте/);
  await page.goto('./#/progress');
  await expect(page.getByText(/Ще немає зважувань/)).toBeVisible();
  await page.goto('./#/report');
  await expect(page.getByRole('region', { name: 'Головне' })).toHaveCount(0);
});

test('the example is a database of its own: the own records stay, «Подивитись приклад» is always in «Ще», no sync in it (D98)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/plan/prescriptions');
  await page.locator('section.rounded-2xl').filter({ has: page.getByRole('heading', { name: 'Призначення', exact: true }) }).getByRole('button', { name: 'Додати' }).click();
  await page.getByRole('dialog', { name: 'Призначення' }).getByRole('textbox', { name: 'Назва' }).fill('Мій препарат');
  await page.getByRole('dialog', { name: 'Призначення' }).getByRole('textbox', { name: /^Доза/ }).fill('1 таб.');
  await page.getByRole('dialog', { name: 'Призначення' }).getByRole('textbox', { name: /^Час прийому/ }).fill('09:00');
  await page.getByRole('dialog', { name: 'Призначення' }).getByRole('button', { name: 'Зберегти' }).click();
  await page.goto('./#/more');
  await page.getByRole('button', { name: /Подивитись на прикладі/ }).click(); // the own plan is not empty — still there
  await page.getByRole('button', { name: 'Відкрити приклад' }).click(); // D99: asked first — the own data stays
  await expect(page.getByText(/Це приклад:/)).toBeVisible();
  await page.goto('./#/plan/prescriptions');
  await expect(page.getByText('Вітамін D')).toBeVisible();
  await expect(page.getByText('Мій препарат')).toHaveCount(0); // not mixed
  await page.goto('./#/sync');
  await expect(page.getByText(/синхронізація в ньому вимкнена/)).toBeVisible();
  // leaving deletes the example's database and reloads — wait for that reload, or it lands after the next navigation
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Повернутися до своїх даних' }).click()]);
  await page.goto('./#/plan/prescriptions');
  await expect(page.getByText('Мій препарат')).toBeVisible(); // the own, untouched
  await expect(page.getByText('Вітамін D')).toHaveCount(0);
});

test('the day\'s own records are there after a look at the example — the example said so, and the way back is named (D99)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const at = await page.evaluate(() => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); const o = -d.getTimezoneOffset(); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T08:00:00${o < 0 ? '-' : '+'}${p(Math.floor(Math.abs(o) / 60))}:${p(Math.abs(o) % 60)}`; }); // the browser's own offset (not «+03:00» all year)
  await seed(page, [{ store: 'entries', value: { id: 'own-1', at, kind: 'meal', status: 'done', title: 'Сніданок', items: [{ foodId: 'egg-boiled', name: 'Яйце варене', grams: 100 }] } }]);
  await expect(page.getByText('Сніданок').first()).toBeVisible();
  await page.goto('./#/more');
  await page.getByRole('button', { name: /Подивитись на прикладі/ }).click();
  await expect(page.getByText(/Ваші дані залишаються окремо/)).toBeVisible();
  await page.getByRole('button', { name: 'Відкрити приклад' }).click();
  await expect(page.getByText(/Ваші власні записи не зникли/)).toBeVisible();
  await page.getByRole('button', { name: 'Повернутися до своїх даних' }).click();
  await expect(page.getByText(/Ваші власні записи не зникли/)).toHaveCount(0);
  await expect(page.getByText('Сніданок').first()).toBeVisible(); // the morning's record, as it was
});

test('the plan history opens separately and explains that sync is required', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/plan');
  await page.getByRole('link', { name: 'Історія попередніх версій' }).click();
  await expect(page).toHaveURL(/#\/plan\/history$/);
  await expect(page.getByRole('heading', { name: 'Попередні версії плану', level: 1 })).toBeVisible();
  await expect(page.getByText(/спершу увімкніть синхронізацію/)).toBeVisible();
  await page.getByRole('link', { name: 'Налаштувати синхронізацію' }).click();
  await expect(page).toHaveURL(/#\/sync$/);
});
