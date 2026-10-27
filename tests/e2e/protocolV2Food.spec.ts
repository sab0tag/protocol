import { addDays } from 'date-fns';
import { expect, test, type Page } from '@playwright/test';
import { device, kyivOffset, seed, ymd } from './helpers';

const records = (page: Page) => page.evaluate(async () => {
  const request = indexedDB.open('protocol');
  await new Promise((resolve) => { request.onsuccess = resolve; });
  const tx = request.result.transaction('entries', 'readonly');
  const all = tx.objectStore('entries').getAll();
  const result = await new Promise<unknown[]>((resolve) => { all.onsuccess = () => resolve(all.result); });
  request.result.close(); return result;
});

test('Food 2.0 repeats at most three distinct completed meals into a checked editable draft, then saves in two interactions', async ({ browser }) => {
  const page = await device(browser);
  const at = (days: number) => { const date = addDays(new Date(), days); return `${ymd(date)}T08:00:00${kyivOffset(date)}`; };
  const meal = (id: string, title: string, days: number, foodId: string, name: string, grams: number, status = 'done') => ({ store: 'entries', value: {
    id, title, at: at(days), kind: 'meal', status, items: [{ foodId, name, grams }],
  } });
  const rows = [
    meal('repeat-latest', 'Недавній перекус', -1, 'milk', 'Молоко 2,5 %', 180),
    meal('repeat-duplicate', 'Такий самий перекус', -2, 'milk', 'Молоко 2,5 %', 180),
    meal('repeat-second', 'Ранкова гречка', -3, 'buckwheat-boiled', 'Гречка варена', 150),
    meal('repeat-third', 'Ранкове яйце', -4, 'egg-boiled', 'Яйце варене', 100),
    meal('repeat-fourth', 'Давній перекус', -5, 'apple', 'Яблуко', 200),
    meal('repeat-skipped', 'Пропущена їжа', -1, 'apple', 'Яблуко', 250, 'skipped'),
    meal('repeat-planned', 'Лише заплановано', -1, 'apple', 'Яблуко', 260, 'planned'),
    meal('repeat-future', 'Майбутній запис', 1, 'apple', 'Яблуко', 270),
  ];
  await seed(page, rows);
  const before = await records(page);
  await page.goto('./#/meal/new');
  const recent = page.getByRole('region', { name: 'Нещодавні' });
  await expect(recent.getByRole('button')).toHaveCount(3);
  await expect(recent).not.toContainText('Такий самий перекус');
  await expect(recent).not.toContainText('Давній перекус');
  await expect(recent).not.toContainText('Лише заплановано');
  await expect(recent).not.toContainText('Пропущена їжа');
  await expect(recent).not.toContainText('Майбутній запис');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/protocol-v2-food-empty-390.png', fullPage: true });
  await recent.getByRole('button', { name: /Недавній перекус/ }).click(); // first interaction
  await expect(recent).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Позиції', exact: true }).getByLabel('Грами')).toHaveValue('180');
  await expect(page.locator('section[aria-live]')).toContainText('Лактоза'); // evaluated against the current plan
  expect(await records(page)).toEqual(before); // repeating is not a saved fact
  const actions = page.getByTestId('meal-save-actions');
  await expect(actions).toContainText('Додано позицій: 1');
  for (const [width, height, colorScheme] of [[320, 568, 'light'], [390, 844, 'dark'], [1024, 768, 'light']] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme });
    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    const button = actions.getByRole('button', { name: 'Додати до дня', exact: true });
    const box = await button.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThan(height - (width < 768 ? 60 : 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const amount = await page.getByRole('region', { name: 'Позиції', exact: true }).getByLabel('Грами').boundingBox();
    expect(amount!.width).toBeGreaterThanOrEqual(80);
    await page.screenshot({ path: `test-results/protocol-v2-food-${width}-${colorScheme}.png`, fullPage: true });
  }
  await actions.getByRole('button', { name: 'Додати до дня', exact: true }).click(); // second interaction
  await expect(page.getByRole('heading', { name: 'Сьогодні', level: 1 })).toBeVisible();
  const after = await records(page) as { id: string; items?: unknown[] }[];
  expect(after).toHaveLength(before.length + 1);
  expect(after.find((e) => !before.some((b) => (b as { id: string }).id === e.id))?.items).toEqual(rows[0]!.value.items);
  for (const original of before) expect(after.find((e) => e.id === (original as { id: string }).id)).toEqual(original);
});

test('Food 2.0 favorites start compact, expand on demand, and editing a repeat keeps the original meal intact', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const day = addDays(new Date(), -1);
  await seed(page, [
    { store: 'entries', value: { id: 'original', at: `${ymd(day)}T08:00:00${kyivOffset(day)}`, kind: 'meal', status: 'done', title: 'Вчорашній кефір', items: [{ foodId: 'kefir', name: 'Кефір 2,5 %', grams: 180 }] } },
    ...[1, 2, 3, 4].map((n) => ({ store: 'favorites', value: { id: `f${n}`, title: `Звичний ${n}`, items: [{ foodId: 'egg-boiled', name: 'Яйце варене', grams: n * 50 }] } })),
  ]);
  await page.goto('./#/meal/new');
  const favorites = page.getByRole('region', { name: 'Мої звичні' });
  await expect(favorites.getByRole('listitem')).toHaveCount(3);
  await favorites.getByRole('button', { name: 'Усі мої звичні (4)' }).click();
  await expect(favorites.getByRole('listitem')).toHaveCount(4);
  await favorites.getByRole('button', { name: 'Показати менше' }).click();
  await expect(favorites.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('region', { name: 'Нещодавні' }).getByRole('button', { name: /Вчорашній кефір/ }).click();
  await page.getByRole('region', { name: 'Позиції', exact: true }).getByLabel('Грами').fill('210');
  const original = (await records(page) as { id: string; items: { grams: number }[] }[]).find((e) => e.id === 'original');
  expect(original?.items[0]?.grams).toBe(180);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Позиції', exact: true }).getByLabel('Грами')).toHaveValue('210');
  await page.getByRole('button', { name: 'Додати до дня', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сьогодні', level: 1 })).toBeVisible();
  await page.goto('./#/meal/new');
  await expect(page.getByRole('region', { name: 'Позиції', exact: true })).toHaveCount(0);
});
