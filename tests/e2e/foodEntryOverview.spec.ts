import { expect, test } from '@playwright/test';
import { device, seed } from './helpers';
import { emptyPlan } from '../../src/data/seed.example';
import { t } from '../../src/i18n/uk';
test('a known allergen is named before anything is saved — in the tile and in the full form, which keeps voice and the label', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [
    { store: 'foods', value: { id: 'synthetic-milk', custom: true, name: 'Синтетичне молоко', per100g: { kcal: 50, protein: 3, fat: 2, carbs: 5 }, tags: [], allergens: ['milk'] } },
    { store: 'plan', value: { ...emptyPlan(), id: 'main', onboardedAt: '2026-10-28', constraints: [{ id: 'allergy', tag: 'allergy', active: true, title: 'Milk', reason: '', source: 'Synthetic', allergens: ['milk'] }] } },
  ]);
  // D159: the tile's suggestion carries the plan's word before the tap
  const lunch = page.locator('[data-testid=meal-tiles] [data-slot="1"]');
  await lunch.getByRole('button', { name: /^Обід/ }).click();
  await lunch.getByPlaceholder('Додати до обіду…').fill('Синтетичне');
  await expect(lunch.locator('button[data-item="Синтетичне молоко"]')).toContainText('алерген');

  await page.goto('./#/meal/new?slot=1');
  await expect(page.getByRole('group', { name: 'Спосіб додавання їжі' })).toHaveCount(0); // no «Написати / Фото / Готове»
  await page.getByText(t.meal.moreEntryMethods, { exact: true }).click();
  await expect(page.getByRole('button', { name: t.meal.modeVoice, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: t.meal.modeLabel, exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('Синтетичне молоко');
  await page.locator('button[data-item="Синтетичне молоко"]').click();
  await expect(page.locator('[data-plan-status=allergen]')).toContainText(t.meal.planAllergen);
  await expect(page.locator('[data-plan-status=allergen]')).toContainText(t.meal.planLimit);
  await expect(page.locator('[data-plan-status=allergen]')).toContainText('молоко');
  for (const width of [320, 1024]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/food-entry-${width}-${colorScheme}.png`, fullPage: true, animations: 'disabled' });
  }
  const count = await page.evaluate(async () => {
    const r = indexedDB.open('protocol'); await new Promise<void>(resolve => { r.onsuccess = () => resolve(); });
    const q = r.result.transaction('entries').objectStore('entries').count(); const n = await new Promise<number>(resolve => { q.onsuccess = () => resolve(q.result); }); r.result.close(); return n;
  });
  expect(count).toBe(0);
  await page.context().close();
});
