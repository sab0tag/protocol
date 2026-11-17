import { addDays } from 'date-fns';
import { expect, test, type Page } from '@playwright/test';
import { device, kyivOffset, seed, ymd } from './helpers';

// D159: «Останні» and «Мої звичні» are gone from the food entry — a meal tile offers what this person usually eats at this meal
// and their pinned meals as chips; a tap writes the line at once.

const records = (page: Page) => page.evaluate(async () => {
  const request = indexedDB.open('protocol');
  await new Promise((resolve) => { request.onsuccess = resolve; });
  const tx = request.result.transaction('entries', 'readonly');
  const all = tx.objectStore('entries').getAll();
  const result = await new Promise<unknown[]>((resolve) => { all.onsuccess = () => resolve(all.result); });
  request.result.close(); return result;
});

test('a meal tile\'s chips are the usual lines of that meal — eaten ones only, each once — and a tap writes it without touching the past', async ({ browser }) => {
  const page = await device(browser);
  const at = (days: number) => { const date = addDays(new Date(), days); return `${ymd(date)}T08:00:00${kyivOffset(date)}`; };
  const meal = (id: string, title: string, days: number, foodId: string, name: string, grams: number, status = 'done') => ({ store: 'entries', value: {
    id, title, at: at(days), kind: 'meal', status, items: [{ foodId, name, grams }],
  } });
  const rows = [
    meal('repeat-latest', 'Недавній перекус', -1, 'milk', 'Молоко 2,5 %', 180),
    meal('repeat-duplicate', 'Такий самий перекус', -2, 'milk', 'Молоко 2,5 %', 180),
    meal('repeat-second', 'Ранкова гречка', -3, 'buckwheat-boiled', 'Гречка варена', 150),
    meal('repeat-fourth', 'Давній перекус', -5, 'apple', 'Яблуко', 200),
    meal('repeat-skipped', 'Пропущений перекус', -1, 'egg-boiled', 'Яйце варене', 250, 'skipped'),
    meal('repeat-planned', 'Запланований перекус', -1, 'kefir', 'Кефір 2,5 %', 260, 'planned'),
    meal('repeat-future', 'Майбутній перекус', 1, 'banana', 'Банан', 270),
  ];
  await seed(page, rows);
  const before = await records(page);
  const snack = page.locator('[data-testid=meal-tiles] [data-slot="3"]');
  await page.getByTestId('meal-tiles').getByRole('button', { name: 'Додати їжу', exact: true }).click(); // D161: a snack is added, not a fixed tile
  await page.getByRole('group', { name: 'Що це за прийом?' }).getByRole('button', { name: 'Перекус', exact: true }).click();
  const chips = snack.getByRole('group', { name: 'Підказки' });
  await expect(chips.getByRole('button', { name: 'Молоко 2,5 % · 180 г' })).toHaveCount(1);
  await expect(chips.getByRole('button', { name: 'Яблуко · 200 г' })).toHaveCount(1);
  await expect(chips).not.toContainText('Гречка'); // breakfast's, not the snack's
  await expect(chips).not.toContainText('Яйце');
  await expect(chips).not.toContainText('Кефір');
  await expect(chips).not.toContainText('Банан');
  for (const [width, colorScheme] of [[320, 'light'], [390, 'dark']] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/protocol-v2-food-tile-${width}-${colorScheme}.png`, fullPage: true });
  }
  await chips.getByRole('button', { name: 'Молоко 2,5 % · 180 г' }).click();
  await expect(snack.getByRole('list', { name: 'Перекус' })).toContainText('Молоко 2,5 %');
  const after = await records(page) as { id: string; items?: unknown[] }[];
  expect(after).toHaveLength(before.length + 1);
  expect(after.find((e) => !before.some((b) => (b as { id: string }).id === e.id))?.items).toEqual(rows[0]!.value.items);
  for (const original of before) expect(after.find((e) => e.id === (original as { id: string }).id)).toEqual(original);
});

test('pinned meals are chips too, at most five with the usual ones; a tap adds the pinned lines', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [1, 2, 3, 4, 5, 6].map((n) => ({ store: 'favorites', value: { id: `f${n}`, title: `Звичний ${n}`, items: [{ foodId: 'egg-boiled', name: 'Яйце варене', grams: n * 50 }] } })));
  const lunch = page.locator('[data-testid=meal-tiles] [data-slot="1"]');
  await lunch.getByRole('button', { name: /^Обід/ }).click();
  await expect(lunch.getByRole('group', { name: 'Підказки' }).getByRole('button')).toHaveCount(5);
  await lunch.getByRole('button', { name: 'Звичний 2', exact: true }).click();
  await expect(lunch.getByRole('list', { name: 'Обід' })).toContainText('Яйце варене');
  await expect(lunch.getByRole('list', { name: 'Обід' })).toContainText('100 г');
  await page.context().close();
});
