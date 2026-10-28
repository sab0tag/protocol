import { expect, test } from '@playwright/test';
import { t } from '../../src/i18n/uk';
import { device, seed } from './helpers';

test('dish catalog searches, filters categories and keeps favorites after reload', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./#/dishes');

  const search = page.getByRole('searchbox', { name: t.dishes.catalog.search });
  const filters = page.getByRole('group', { name: t.dishes.catalog.filters });
  const borscht = page.locator('[data-catalog-dish="Борщ"]');

  await expect(search).toBeVisible();
  await expect(borscht.locator('img')).toHaveAttribute('src', /food-soup/);
  await expect(page.getByRole('region', { name: t.dishes.breakdown.title })).toBeHidden();
  await filters.getByRole('button', { name: t.meal.names[0]!, exact: true }).click();
  await expect(page.locator('[data-catalog-dish="Омлет з 2 яєць"]')).toBeVisible();
  await expect(borscht).toHaveCount(0);

  await filters.getByRole('button', { name: t.dishes.catalog.all, exact: true }).click();
  await search.fill('буряк');
  await expect(borscht).toBeVisible();
  await expect(page.locator('[data-catalog-dish="Вінегрет"]')).toBeVisible();
  await search.clear();

  await borscht.getByRole('button', { name: t.meal.addFavorite('Борщ') }).click();
  await expect(borscht.getByRole('button', { name: t.meal.removeFavorite('Борщ') })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await filters.getByRole('button', { name: t.dishes.catalog.favorites, exact: true }).click();
  await expect(borscht).toBeVisible();
  await expect(page.locator('[data-catalog-dish="Омлет з 2 яєць"]')).toHaveCount(0);

  await borscht.getByRole('button', { name: t.meal.removeFavorite('Борщ') }).click();
  await expect(page.getByText(t.dishes.catalog.empty, { exact: true })).toBeVisible();

  await filters.getByRole('button', { name: t.dishes.catalog.all, exact: true }).click();
  await page.getByRole('button', { name: t.dishes.catalog.addDish }).click();
  await expect(page.getByRole('region', { name: t.dishes.breakdown.title })).toBeVisible();
  await page.getByRole('button', { name: t.dishes.catalog.hideBreakdown }).click();
  await expect(page.getByRole('region', { name: t.dishes.breakdown.title })).toBeHidden();
  await page.context().close();
});

test('dish catalog stays usable at target widths and themes', async ({ browser }) => {
  const page = await device(browser, 'skip');
  for (const [width, height] of [[320, 568], [390, 844], [768, 900], [1024, 768]] as const) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme });
      await page.goto('./#/dishes');
      await expect(page.getByRole('heading', { level: 1, name: t.dishes.title })).toBeVisible();
      await expect(page.getByRole('searchbox', { name: t.dishes.catalog.search })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px ${colorScheme}`).toBe(true);
      await expect(page.locator('html')).toHaveCSS('color-scheme', colorScheme);
      await page.screenshot({ path: `test-results/dishes-catalog-${width}-${colorScheme}.png`, fullPage: true });
    }
  }
  await page.context().close();
});

test('own dishes can still be renamed and deleted from card details', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [{ store: 'recipes', value: { id: 'catalog-own-dish', name: 'Мій омлет', items: [{ foodId: 'egg', name: 'Яйце', grams: 100 }] } }]);
  await page.goto('./#/dishes');

  const card = page.locator('[data-catalog-dish="Мій омлет"]');
  await card.getByRole('button', { name: `${t.dishes.catalog.more}: Мій омлет` }).click();
  await card.getByRole('textbox', { name: t.dishes.rename }).fill('Омлет на сніданок');
  await card.getByRole('textbox', { name: t.dishes.rename }).press('Tab');
  const renamed = page.locator('[data-catalog-dish="Омлет на сніданок"]');
  await expect(renamed).toBeVisible();
  await renamed.getByRole('button', { name: `${t.dishes.delete}: Омлет на сніданок` }).click();
  const dialog = renamed.getByRole('alertdialog');
  await expect(dialog).toContainText(t.dishes.confirmDelete('Омлет на сніданок'));
  await dialog.getByRole('button', { name: t.dishes.delete, exact: true }).click();
  await expect(renamed).toHaveCount(0);
  await page.context().close();
});
