import { expect, test } from '@playwright/test';
import { device, toast } from './helpers';

test('a meal pinned «У звичні» comes back as a chip in any meal tile, one tap (D51, D159)', async ({ browser }) => {
  const page = await device(browser);
  await page.setViewportSize({ width: 320, height: 844 });
  const snack = page.locator('[data-testid=meal-tiles] [data-slot="3"]');
  await page.getByTestId('meal-tiles').getByRole('button', { name: 'Додати їжу', exact: true }).click(); // D161: a snack is added, not a fixed tile
  await page.getByRole('group', { name: 'Що це за прийом?' }).getByRole('button', { name: 'Перекус', exact: true }).click();
  await snack.getByPlaceholder('Додати до перекусу…').fill('кефір');
  await snack.getByRole('list', { name: 'Підказки' }).getByRole('button', { name: /^Кефір 2,5 %/ }).first().click();
  await expect(toast(page)).toContainText('Додано: Кефір 2,5 %');
  await snack.getByRole('button', { name: 'Готово' }).click();

  await page.getByText(/^Виконано та інші відмітки/).click();
  const recordedMeal = page.getByRole('button', { name: /^Перекус, Виконано/ });
  // Center the row before the tap so the scroll-triggered floating dock settles outside its hit area.
  await recordedMeal.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await recordedMeal.click();
  const mealActions = page.getByRole('dialog', { name: 'Перекус', exact: true });
  await mealActions.getByRole('button', { name: 'У звичні', exact: true }).click();
  await expect(toast(page)).toContainText('«Перекус» — у звичних');

  const breakfast = page.locator('[data-testid=meal-tiles] [data-slot="0"]');
  await breakfast.getByRole('button', { name: /^Сніданок/ }).click();
  await breakfast.getByRole('group', { name: 'Підказки' }).getByRole('button', { name: 'Перекус', exact: true }).click();
  await expect(breakfast.getByRole('list', { name: 'Сніданок' })).toContainText('Кефір 2,5 %');
});

test('a confirmed allergy entered in «План»: marked in the tile and in search, «Прибрати» in the check (D58, D159)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/plan/constraints');
  await page.locator('section.rounded-2xl').filter({ has: page.getByRole('heading', { name: 'Дієта й обмеження', exact: true }) }).getByRole('button', { name: 'Додати' }).click();
  const form = page.getByRole('dialog', { name: 'Дієта й обмеження' });
  await form.getByRole('combobox', { name: 'Що це за обмеження' }).selectOption('allergy');
  await form.getByRole('button', { name: 'горіхи', exact: true }).click();
  await form.getByRole('textbox', { name: 'Джерело' }).fill('Алерголог, 2026');
  await form.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.getByText('Алергія: горіхи')).toBeVisible();

  // D159: in the tile the suggestion carries the plan's word; written, the meal's line names the allergen
  await page.goto('./#/');
  const lunch = page.locator('[data-testid=meal-tiles] [data-slot="1"]');
  await lunch.getByRole('button', { name: /^Обід/ }).click();
  await lunch.getByPlaceholder('Додати до обіду…').fill('волоські');
  const suggestion = lunch.getByRole('list', { name: 'Підказки' }).getByRole('button', { name: /^Волоські горіхи/ }).first();
  await expect(suggestion).toContainText('алерген');
  await suggestion.click();
  await expect(lunch.locator('[data-plan-status=allergen]')).toContainText('Виявлено алерген із вашого плану');
  await lunch.locator('[data-plan-status=allergen]').getByRole('button', { name: 'Чому?' }).click();
  await expect(lunch.locator('[data-plan-status=allergen]')).toContainText('Алергія: горіхи');

  // the full form: marked in search, «Прибрати» in the check; D77: what was eaten is recorded as it was — no swap
  await page.goto('./#/meal/new?slot=1');
  await page.getByRole('searchbox', { name: /^Що з’їли/ }).fill('волоські');
  const hit = page.getByRole('button', { name: /^Волоські горіхи/ }).first();
  await expect(hit).toContainText('алергія: горіхи');
  await hit.click();
  await expect(page.locator('section[aria-live]', { hasText: 'Перевірка за планом лікаря' })).toContainText('Алергія: горіхи');
  await expect(page.getByText(/Заміни вище — підказка на наступний раз/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Записати заміну' })).toHaveCount(0);
});

test('a new meal not yet written survives a reload; once written, the next form is empty (D131)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/meal/new?slot=1');
  await page.getByRole('searchbox', { name: /^Що з’їли/ }).fill('кефір');
  await page.getByRole('button', { name: /^Кефір 2,5 %/ }).first().click();
  await page.reload();
  await expect(page.getByText('Кефір 2,5 %').first()).toBeVisible();
  await page.getByRole('button', { name: 'Додати до дня', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Сьогодні' })).toBeVisible();
  await page.goto('./#/meal/new?slot=1');
  await expect(page.getByRole('button', { name: 'Додати до дня', exact: true })).toBeDisabled();
});
