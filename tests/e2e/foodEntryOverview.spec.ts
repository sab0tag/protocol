import { expect, test } from '@playwright/test';
import { device, seed } from './helpers';
import { emptyPlan } from '../../src/data/seed.example';
import { t } from '../../src/i18n/uk';
test('three entry paths retain secondary tools and explain a known allergen before saving', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [
    { store: 'foods', value: { id: 'synthetic-milk', custom: true, name: 'Синтетичне молоко', per100g: { kcal: 50, protein: 3, fat: 2, carbs: 5 }, tags: [], allergens: ['milk'] } },
    { store: 'plan', value: { ...emptyPlan(), id: 'main', onboardedAt: '2026-10-28', constraints: [{ id: 'allergy', tag: 'allergy', active: true, title: 'Milk', reason: '', source: 'Synthetic', allergens: ['milk'] }] } },
  ]);
  await page.goto('./#/meal/new');
  const modes = page.getByRole('group', { name: t.meal.entryModes }); await expect(modes.getByRole('button')).toHaveCount(3);
  await modes.getByRole('button', { name: t.meal.entryWrite, exact: true }).click();
  await expect(page.getByRole('searchbox')).toBeFocused();
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
  await modes.getByRole('button', { name: t.meal.entryReady, exact: true }).click();
  const ready = page.getByRole('region', { name: t.meal.entryReady }); await expect(ready).toBeVisible();
  await ready.getByRole('button').first().click(); await expect(ready).toHaveCount(0);
  const count = await page.evaluate(async () => {
    const r = indexedDB.open('protocol'); await new Promise<void>(resolve => { r.onsuccess = () => resolve(); });
    const q = r.result.transaction('entries').objectStore('entries').count(); const n = await new Promise<number>(resolve => { q.onsuccess = () => resolve(q.result); }); r.result.close(); return n;
  });
  expect(count).toBe(0);
  await page.context().close();
});
