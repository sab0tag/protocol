import { expect, test } from '@playwright/test';
import { device, toast } from './helpers';

test('«Записати їжу»: the food first, the meal line folded; a meal pinned to «Мої звичні» comes back in one tap (D51)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/meal/new');
  const search = page.getByRole('searchbox', { name: /^Що з’їли/ });
  await expect(search).toBeFocused();
  await search.fill('кефір');
  await page.getByRole('button', { name: /^Кефір 2,5 %/ }).first().click();
  const line = page.getByRole('button', { name: /^Прийом: назва, час/ });
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await line.click();
  await page.getByRole('button', { name: 'Перекус', exact: true }).click();
  await expect(line).toContainText('Перекус');
  await page.getByRole('button', { name: 'Записати', exact: true }).click();
  await expect(toast(page)).toContainText('Перекус');

  await page.getByRole('button', { name: /^Перекус,/ }).click();
  await page.getByRole('button', { name: 'У звичні' }).click();
  await expect(toast(page)).toContainText('«Перекус» — у звичних');

  await page.goto('./#/meal/new');
  const fav = page.getByRole('button', { name: /^Перекус Кефір 2,5 %/ });
  await fav.click();
  await expect(page.locator('li').filter({ hasText: 'Кефір 2,5 %' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Прибрати зі звичних: Перекус' }).click();
  await expect(toast(page)).toContainText('прибрано зі звичних');
  await expect(fav).toHaveCount(0);
});
