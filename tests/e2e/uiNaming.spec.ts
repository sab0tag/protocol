import { expect, test } from '@playwright/test';
import { device, kyivOffset, seed, ymd } from './helpers';

test('mock-aligned labels distinguish adding food from saving an existing meal', async ({ browser }) => {
  const page = await device(browser);
  await seed(page, [{ store: 'entries', value: {
    id: 'naming-meal', at: `${ymd(new Date())}T08:00:00${kyivOffset()}`, kind: 'meal', status: 'done', title: 'Сніданок',
    items: [{ foodId: 'egg-boiled', name: 'Яйце варене', grams: 50 }],
  } }]);
  await page.goto('./#/meal/naming-meal');
  await expect(page.getByRole('heading', { name: 'Редагувати прийом їжі', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Додати до дня', exact: true })).toHaveCount(0);
  await page.getByRole('region', { name: 'Позиції', exact: true }).getByLabel('Грами').fill('75');
  await page.getByRole('button', { name: 'Зберегти зміни', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сьогодні', level: 1, exact: true })).toBeVisible();
  const entries = await page.evaluate(async () => {
    const req = indexedDB.open('protocol');
    await new Promise((resolve) => { req.onsuccess = resolve; });
    const get = req.result.transaction('entries').objectStore('entries').getAll();
    const rows = await new Promise<{ id: string; items?: { grams: number }[] }[]>((resolve) => { get.onsuccess = () => resolve(get.result); });
    req.result.close(); return rows;
  });
  expect(entries.filter((e) => e.id === 'naming-meal')).toHaveLength(1);
  expect(entries.find((e) => e.id === 'naming-meal')?.items?.[0]?.grams).toBe(75);
  await page.getByRole('button', { name: 'Самопочуття', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Самопочуття', exact: true, level: 1 })).toBeVisible();
  await page.goto('./#/meal/new');
  await expect(page.getByRole('heading', { name: 'Записати їжу', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Додати до дня', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Фото', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Голос', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Текст', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: /Що з’їли/ })).toBeFocused();
  await page.getByRole('button', { name: 'Скан етикетки', exact: true }).click();
  await expect(page.getByRole('button', { name: /Фото етикетки/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скан етикетки', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Скан етикетки', exact: true }).click();
  await page.getByRole('button', { name: 'Голос', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Скажіть, що з’їли чи прийняли' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Записати їжу', exact: true, level: 1 })).toBeVisible();
  await page.context().close();
});
