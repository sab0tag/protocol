import { expect, test, type Page } from '@playwright/test';
import { device, kyivOffset, seed, toast, ymd } from './helpers';

// D159: the day's food as tiles on «Сьогодні» (D161: three meals and each snack) — written in place, never asked which meal or when.

async function at(page: Page, time: string): Promise<Date> {
  const now = new Date(); const [h, m] = time.split(':').map(Number); now.setHours(h!, m!, 0, 0);
  await page.clock.setFixedTime(now);
  await page.goto('./#/');
  await page.reload();
  return now;
}
const tile = (page: Page, name: string) => page.locator('[data-testid=meal-tiles] [data-slot]').filter({ has: page.getByRole('button', { name: new RegExp(`^${name}`) }) });

test('at 12:00 an empty breakfast says «не записано»; a tap on a suggestion writes it at once with «Скасувати», the time not asked', async ({ browser }) => {
  const page = await device(browser);
  await at(page, '12:00');
  const breakfast = tile(page, 'Сніданок');
  await expect(breakfast.getByRole('button', { name: /Сніданок — не записано · Додати/ })).toBeVisible();
  await expect(page.getByText('Уже з’їдено')).toHaveCount(0);
  await breakfast.getByRole('button', { name: /Сніданок/ }).click();
  const field = breakfast.getByPlaceholder('Додати до сніданку…');
  await expect(field).toBeFocused();
  await field.fill('г');
  await expect(breakfast.getByRole('list', { name: 'Підказки' })).toHaveCount(0); // one letter is not enough
  await field.fill('гр');
  const list = breakfast.getByRole('list', { name: 'Підказки' });
  await expect(list.getByRole('button').first()).toBeVisible();
  expect(await list.getByRole('button').count()).toBeLessThanOrEqual(6);
  const first = list.getByRole('button').first();
  const name = (await first.getAttribute('data-item'))!;
  await first.click();
  await expect(toast(page)).toContainText(`Додано: ${name}`);
  await expect(toast(page).getByRole('button', { name: 'Скасувати' })).toBeVisible();
  await expect(field).toHaveValue('');
  await expect(breakfast.getByRole('list', { name: 'Сніданок' })).toContainText(name);
  await expect(breakfast.getByRole('list', { name: 'Сніданок' })).toContainText('08:00'); // breakfast is over: its usual time, not «now»
  await expect(breakfast.locator('[data-plan-status]')).toBeVisible(); // the plan's line for this meal
  await toast(page).getByRole('button', { name: 'Скасувати' }).click();
  await expect(breakfast.getByRole('list', { name: 'Сніданок' })).toHaveCount(0);
});

test('a phrase is a draft: nothing is written until «Додати все»', async ({ browser }) => {
  const page = await device(browser);
  await at(page, '13:10');
  const lunch = tile(page, 'Обід');
  await lunch.getByRole('button', { name: /^Обід/ }).click();
  await lunch.getByPlaceholder('Додати до обіду…').fill('гречка, яйце і кава');
  await expect(lunch.getByText('Розпізнано')).toBeVisible();
  await expect(lunch.getByRole('list', { name: 'Обід' })).toHaveCount(0);
  await lunch.getByRole('button', { name: /Додати все/ }).click();
  await expect(lunch.getByRole('list', { name: 'Обід' }).getByRole('button')).toHaveCount(3);
  await expect(lunch.getByRole('list', { name: 'Обід' })).toContainText('13:10'); // the meal going on now: now
  await lunch.getByRole('button', { name: 'Готово' }).click();
  await expect(lunch.getByRole('button', { name: /^Обід · .*Гречка/ })).toBeVisible();
});

test('«Як учора» — breakfast recorded in two taps from «Сьогодні»; /meal/new opens the meal going on now', async ({ browser }) => {
  const page = await device(browser);
  const now = await at(page, '09:00');
  const prev = new Date(now); prev.setDate(prev.getDate() - 1);
  await seed(page, [{ store: 'entries', value: { id: 'y-breakfast', at: `${ymd(prev)}T08:15:00${kyivOffset(prev)}`, kind: 'meal', status: 'done', title: 'Сніданок',
    items: [{ foodId: 'oatmeal-water', name: 'Вівсянка на воді', grams: 250, unit: { name: 'порція', qty: 1, grams: 250 } }] } }]);
  const breakfast = tile(page, 'Сніданок');
  await breakfast.getByRole('button', { name: /^Сніданок/ }).click(); // 1
  await breakfast.getByRole('button', { name: 'Як учора: Вівсянка на воді' }).click(); // 2
  await expect(breakfast.getByRole('list', { name: 'Сніданок' })).toContainText('Вівсянка на воді');
  await expect(breakfast.getByRole('list', { name: 'Сніданок' })).toContainText('09:00');

  await page.goto('./#/meal/new');
  await expect(page).toHaveURL(/#\/$/);
  await expect(tile(page, 'Сніданок').getByPlaceholder('Додати до сніданку…')).toBeFocused();
});

test('a line is corrected by a tap: portion and time in one sheet; the full form keeps the label and a free line', async ({ browser }) => {
  const page = await device(browser);
  const now = await at(page, '20:00');
  await seed(page, [{ store: 'entries', value: { id: 't-dinner', at: `${ymd(now)}T19:00:00${kyivOffset(now)}`, kind: 'meal', status: 'done', title: 'Вечеря',
    items: [{ foodId: 'oatmeal-water', name: 'Вівсянка на воді', grams: 250, unit: { name: 'порція', qty: 1, grams: 250 } }] } }]);
  const dinner = tile(page, 'Вечеря');
  await dinner.getByRole('button', { name: /^Вечеря · Вівсянка/ }).click();
  await dinner.getByRole('list', { name: 'Вечеря' }).getByRole('button').first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Кількість').fill('2');
  await sheet.getByLabel('Час прийому').fill('18:30');
  await sheet.getByRole('button', { name: 'Зберегти' }).click();
  await expect(dinner.getByRole('list', { name: 'Вечеря' })).toContainText('2 порції');
  await expect(dinner.getByRole('list', { name: 'Вечеря' })).toContainText('18:30');
  await dinner.getByRole('link', { name: 'Етикетка, вручну, склад страви' }).click();
  await expect(page).toHaveURL(/#\/meal\/new\?slot=2$/);
  await expect(page.getByRole('button', { name: 'Свого немає в базі? Додати вручну' })).toBeVisible();
  await expect(page.getByText('Уже з’їдено')).toHaveCount(0);
});

test('D161: a snack is added as a block of its own — two snacks are two blocks between the meals; «Додати їжу → Обід» opens lunch', async ({ browser }) => {
  const page = await device(browser);
  const d = ymd(new Date());
  await seed(page, [{ store: 'entries', value: { id: 'snack-am', at: `${d}T10:30:00${kyivOffset()}`, kind: 'meal', status: 'done', title: 'Перекус',
    items: [{ foodId: 'egg-boiled', name: 'Яйце варене', grams: 50 }] } }]);
  await at(page, '15:00');
  const blocks = page.locator('[data-testid=meal-tiles] [data-slot]');
  await expect(blocks).toHaveCount(4); // no empty fixed «Перекус»: three meals and the one snack eaten
  await expect(blocks.nth(1)).toHaveAttribute('data-slot', '3'); // 10:30 — between breakfast and lunch
  await expect(blocks.nth(1)).toContainText('10:30');

  await page.getByTestId('meal-tiles').getByRole('button', { name: 'Додати їжу', exact: true }).click();
  await page.getByRole('group', { name: 'Що це за прийом?' }).getByRole('button', { name: 'Перекус', exact: true }).click();
  const fresh = page.locator('[data-testid=meal-tiles] [data-slot="3"]').filter({ has: page.getByPlaceholder('Додати до перекусу…') });
  const field = fresh.getByPlaceholder('Додати до перекусу…');
  await expect(field).toBeFocused();
  await field.fill('кефір');
  await fresh.getByRole('list', { name: 'Підказки' }).getByRole('button', { name: /^Кефір 2,5 %/ }).first().click();
  await expect(toast(page)).toContainText('Додано: Кефір 2,5 %');
  await expect(blocks).toHaveCount(5);
  await expect(blocks.nth(3)).toHaveAttribute('data-slot', '3'); // 15:00 — after lunch, before dinner
  await expect(blocks.nth(3)).toContainText('Кефір 2,5 %');
  await expect(blocks.nth(1)).not.toContainText('Кефір'); // the morning snack keeps its own record
  const snacks = await page.evaluate(async () => {
    const r = indexedDB.open('protocol'); await new Promise((ok) => { r.onsuccess = ok; });
    const q = r.result.transaction('entries').objectStore('entries').getAll();
    const rows = await new Promise<{ title: string; items?: { name: string }[] }[]>((ok) => { q.onsuccess = () => ok(q.result); }); r.result.close();
    return rows.filter((e) => e.title === 'Перекус').map((e) => e.items!.map((i) => i.name).join(', ')).sort();
  });
  expect(snacks).toEqual(['Кефір 2,5 %', 'Яйце варене']);
  await page.getByTestId('meal-tiles').screenshot({ path: 'test-results/mockup-meal-tiles-snacks.png' });

  await page.getByTestId('meal-tiles').getByRole('button', { name: 'Додати їжу', exact: true }).click();
  await page.getByRole('group', { name: 'Що це за прийом?' }).getByRole('button', { name: 'Обід', exact: true }).click();
  await expect(tile(page, 'Обід').getByPlaceholder('Додати до обіду…')).toBeFocused();
  await expect(blocks).toHaveCount(5); // a main meal is not doubled
});

test('D164: a long press on «Як учора» offers the same meal on another day of the week — «Як у …» writes it', async ({ browser }) => {
  const page = await device(browser);
  const day = (back: number) => { const d = new Date(); d.setDate(d.getDate() - back); return d; };
  await seed(page, [
    { store: 'entries', value: { id: 'b-1', at: `${ymd(day(1))}T08:00:00${kyivOffset(day(1))}`, kind: 'meal', status: 'done', title: 'Сніданок', items: [{ foodId: 'egg-boiled', name: 'Яйце варене', grams: 50 }] } },
    { store: 'entries', value: { id: 'b-3', at: `${ymd(day(3))}T08:00:00${kyivOffset(day(3))}`, kind: 'meal', status: 'done', title: 'Сніданок', items: [{ foodId: 'oatmeal-water', name: 'Вівсянка на воді', grams: 250 }] } },
  ]);
  await at(page, '09:00');
  const breakfast = tile(page, 'Сніданок');
  await breakfast.getByRole('button', { name: /^Сніданок/ }).click();
  await breakfast.getByRole('button', { name: /^Як учора/ }).click({ button: 'right' }); // a long press on a phone
  const days = breakfast.getByRole('group', { name: 'Як у який день?' });
  await expect(days.getByRole('button')).toHaveCount(2);
  await days.getByRole('button').filter({ hasText: 'Вівсянка на воді' }).click();
  await expect(toast(page)).toContainText('Додано: Вівсянка на воді');
  await expect(breakfast.getByRole('list', { name: 'Сніданок' })).toContainText('Вівсянка на воді');
});

