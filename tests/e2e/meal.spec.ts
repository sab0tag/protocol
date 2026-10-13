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

test('a confirmed allergy entered in «План»: marked in search, «Прибрати» in the check (D58)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/plan');
  await page.locator('section.rounded-2xl').filter({ has: page.getByRole('heading', { name: 'Обмеження', exact: true }) }).getByRole('button', { name: 'Додати' }).click();
  const form = page.getByRole('dialog', { name: 'Обмеження' });
  await form.getByRole('combobox', { name: 'Що це за обмеження' }).selectOption('allergy');
  await form.getByRole('button', { name: 'горіхи', exact: true }).click();
  await form.getByRole('textbox', { name: 'Джерело' }).fill('Алерголог, 2026');
  await form.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.getByText('Алергія: горіхи')).toBeVisible();

  await page.goto('./#/meal/new');
  await page.getByRole('searchbox', { name: /^Що з’їли/ }).fill('волоські');
  const hit = page.getByRole('button', { name: /^Волоські горіхи/ }).first();
  await expect(hit).toContainText('алергія: горіхи');
  await hit.click();
  await expect(page.locator('section[aria-live]', { hasText: 'Перевірка за планом лікаря' })).toContainText('Алергія: горіхи');
  await expect(page.getByRole('button', { name: 'Записати заміну' })).toBeVisible(); // the swap drops the line
});
