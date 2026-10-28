import { expect, test } from '@playwright/test';
import { device, seed } from './helpers';
import { emptyPlan } from '../../src/data/seed.example';
import { t } from '../../src/i18n/uk';

const L = t.nutrition;

test('food tab opens the daily hub and keeps empty data and absent targets explicit', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.getByRole('navigation', { name: 'Розділи', exact: true }).getByRole('link', { name: t.nav.food, exact: true }).click();
  await expect(page).toHaveURL(/#\/food$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(L.title);
  await expect(page.getByText(L.empty, { exact: true })).toBeVisible();
  await expect(page.getByText(L.noRecorded, { exact: true })).toBeVisible();
  await expect(page.getByText(L.noTarget, { exact: true })).toHaveCount(2);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByText(L.noRestrictions, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: t.meal.title, exact: true }).click();
  await expect(page).toHaveURL(/#\/meal\/new$/);
  await expect(page.getByRole('group', { name: t.meal.entryModes }).getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('navigation', { name: 'Розділи', exact: true }).getByRole('link', { name: t.nav.food, exact: true })).toHaveAttribute('aria-current', 'page');
  await page.context().close();
});

test('daily hub excludes planned/skipped meals, preserves dates and explains composition warnings', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const dates = await page.evaluate(() => {
    const day = new Date(), pad = (n: number) => String(n).padStart(2, '0');
    const date = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = date(day); day.setDate(day.getDate() - 1); return { today, yesterday: date(day) };
  });
  const at = (day: string, hour: string) => `${day}T${hour}:00+02:00`;
  const item = { foodId: 'synthetic-milk', name: 'Синтетичне молоко', grams: 100 };
  await seed(page, [
    { store: 'foods', value: { id: 'synthetic-milk', custom: true, name: item.name, per100g: { kcal: 50, protein: 3, fat: 2, carbs: 5 }, tags: [], allergens: ['milk'] } },
    { store: 'plan', value: { ...emptyPlan(), id: 'main', onboardedAt: dates.today, targets: { kcal: 100, proteinG: 20, carbsG: { max: 30 } },
      constraints: [{ id: 'allergy', tag: 'allergy', active: true, title: 'Синтетичне обмеження молока', reason: 'Тестова причина', source: 'Synthetic fixture', allergens: ['milk'] }],
      modes: [{ id: 'test-mode', title: 'Тестовий режим', from: dates.today, to: dates.today, targetsOverride: { kcal: 200 }, notes: [] }] } },
    ...(['done', 'planned', 'skipped'] as const).map((status, i) => ({ store: 'entries', value: { id: status, at: at(dates.today, `${8 + i}`.padStart(2, '0')), kind: 'meal', status, title: `Синтетичний ${status}`, items: [{ ...item, grams: status === 'done' ? 100 : 1000 }] } })),
    { store: 'entries', value: { id: 'unknown', at: at(dates.today, '12:00'), kind: 'meal', status: 'done', title: 'Невідомий склад', items: [{ name: 'Власна страва', grams: 100 }] } },
    { store: 'entries', value: { id: 'yesterday', at: at(dates.yesterday, '12:00'), kind: 'meal', status: 'done', title: 'Попередній день', items: [{ ...item, grams: 200 }] } },
  ]);
  await page.goto('./#/food');
  const progress = page.getByRole('region', { name: L.progress, exact: true });
  await expect(progress).toContainText('50 / 200 ккал');
  await expect(progress).toContainText('3 / 20 г');
  await expect(progress).toContainText(L.incomplete);
  await expect(progress.getByRole('progressbar', { name: t.summary.kcal, exact: true })).toHaveAttribute('aria-valuenow', '25');
  await expect(page.locator('[data-plan-status=allergen]')).toHaveCount(2);
  await expect(page.locator('[data-plan-status=allergen]').first()).toContainText('молоко');
  await expect(page.locator('[data-plan-status=incomplete]')).toContainText(t.meal.planIncomplete);
  await expect(page.getByText(t.meal.planLimit, { exact: true })).toBeVisible();
  await expect(page.getByText('Тестова причина', { exact: true })).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) for (const width of [320, 1024]) {
    await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/nutrition-recorded-${width}-${colorScheme}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: L.previous, exact: true }).click();
  await expect(progress).toContainText('100 / 100 ккал');
  await expect(page.getByRole('heading', { name: 'Попередній день', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Синтетичний done', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: t.day.today, exact: true }).click();
  await page.getByText(L.details, { exact: true }).first().click();
  await page.getByRole('link', { name: L.edit, exact: true }).first().click();
  await expect(page).toHaveURL(/#\/meal\/done$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.meal.editTitle);
  const count = await page.evaluate(async () => {
    const r = indexedDB.open('protocol'); await new Promise<void>(resolve => { r.onsuccess = () => resolve(); });
    const q = r.result.transaction('entries').objectStore('entries').count(); const n = await new Promise<number>(resolve => { q.onsuccess = () => resolve(q.result); }); r.result.close(); return n;
  });
  expect(count).toBe(5);
  await page.context().close();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`nutrition hub remains readable on phone and desktop in ${colorScheme}`, async ({ browser }) => {
    const page = await device(browser, 'skip');
    await page.emulateMedia({ colorScheme });
    await page.goto('./#/food');
    for (const width of [320, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(L.title);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/nutrition-${width}-${colorScheme}.png`, fullPage: true });
    }
    await page.context().close();
  });
}
