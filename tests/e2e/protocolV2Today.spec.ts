import { expect, test } from '@playwright/test';
import { device } from './helpers';

test('Protocol 2.0 Today hero retains accessible date navigation and actionable cards', async ({ browser }) => {
  const page = await device(browser);
  const hero = page.locator('header.protocol-day-hero');
  await expect(hero).toBeVisible();
  await expect(hero.getByText('Протокол')).toBeVisible();
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText('Сьогодні');
  const week = hero.getByRole('navigation', { name: 'Тиждень' });
  await expect(week.getByRole('button')).toHaveCount(9);
  await expect(week.locator('button[aria-current="date"]')).toHaveCount(1);
  // The focus card is intentionally absent when nothing is due or upcoming.\n  // Verify the persistent sections instead of assuming a due item exists.
  await expect(page.getByRole('region', { name: 'Сьогодні' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Найближче' })).toBeVisible();
  await week.getByRole('button', { name: 'Попередній тиждень' }).click();
  await expect(hero.getByRole('heading', { level: 1 })).not.toHaveText('Сьогодні');
  await expect(page.getByRole('region', { name: 'Ритм дня', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Підсумок дня', exact: true })).toBeVisible();
  await hero.getByRole('button', { name: 'До сьогодні' }).click();
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText('Сьогодні');
  await page.screenshot({ path: 'test-results/protocol-v2-today-mobile.png', fullPage: true });
});
