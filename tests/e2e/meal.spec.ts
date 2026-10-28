import { expect, test } from '@playwright/test';
import { device, toast } from './helpers';

test('«Записати їжу» shows four input modes before search; the meal line stays folded and a pinned meal returns in one tap (D51)', async ({ browser }) => {
  const page = await device(browser, 'demo');
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('./#/meal/new');
  const search = page.getByRole('searchbox', { name: /^Що з’їли/ });
  await expect(page.getByRole('group', { name: 'Спосіб додавання їжі' })).toBeVisible();
  await expect(search).not.toBeFocused();
  const actions = page.getByTestId('meal-save-actions');
  await expect(actions).not.toHaveClass(/sticky/);
  const recent = page.getByRole('region', { name: 'Останні' });
  const manual = page.getByRole('button', { name: 'Свого немає в базі? Додати вручну' });
  await expect(recent).toBeVisible();
  const [recentBox, manualBox] = await Promise.all([recent.boundingBox(), manual.boundingBox()]);
  expect(recentBox).not.toBeNull();
  expect(manualBox).not.toBeNull();
  expect(recentBox!.y).toBeLessThan(manualBox!.y);
  const searchLabel = page.getByText(/^Що з’їли/);
  const [labelBox, searchBox] = await Promise.all([searchLabel.boundingBox(), search.boundingBox()]);
  expect(labelBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(searchBox!.y);
  await search.fill('кефір');
  await page.getByRole('button', { name: /^Кефір 2,5 %/ }).first().click();
  await expect(actions).toHaveClass(/sticky/);
  const line = page.getByRole('button', { name: /^Прийом: назва, час/ });
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await line.click();
  await page.getByRole('button', { name: 'Перекус', exact: true }).click();
  await expect(line).toContainText('Перекус');
  await page.getByRole('button', { name: 'Додати до дня', exact: true }).click();
  await expect(toast(page)).toContainText('Перекус');

  await page.getByRole('button', { name: /^Перекус, Виконано/ }).click();
  await page.getByRole('button', { name: 'У звичні' }).click();
  await expect(toast(page)).toContainText('«Перекус» — у звичних');

  await page.goto('./#/meal/new');
  await expect(page.getByText(/^Як раніше ·/)).toHaveCount(0);
  const fav = page.getByRole('region', { name: 'Мої звичні' }).getByRole('button', { name: /^Перекус Кефір 2,5 %/ });
  await fav.click();
  await expect(page.locator('li').filter({ hasText: 'Кефір 2,5 %' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Прибрати зі звичних: Перекус' }).click();
  await expect(toast(page)).toContainText('прибрано зі звичних');
  await expect(fav).toHaveCount(0);
});

test('a confirmed allergy entered in «План»: marked in search, «Прибрати» in the check (D58)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/plan/constraints');
  await page.locator('section.rounded-2xl').filter({ has: page.getByRole('heading', { name: 'Дієта й обмеження', exact: true }) }).getByRole('button', { name: 'Додати' }).click();
  const form = page.getByRole('dialog', { name: 'Дієта й обмеження' });
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
  // D77: what was eaten is recorded as it was — the swap is only a hint for next time
  await expect(page.getByText(/Заміни вище — підказка на наступний раз/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Записати заміну' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Прийом: назва, час, з’їдено чи заплановано' }).click();
  await page.getByRole('checkbox', { name: 'Уже з’їдено' }).uncheck(); // a planned meal — now the swap is offered
  await expect(page.getByRole('button', { name: 'Записати заміну' })).toBeVisible(); // the swap drops the line
});

test('a new meal not yet written survives a reload; once written, the next form is empty (D131)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/meal/new');
  await page.getByRole('searchbox', { name: /^Що з’їли/ }).fill('кефір');
  await page.getByRole('button', { name: /^Кефір 2,5 %/ }).first().click();
  await page.reload();
  await expect(page.getByText('Кефір 2,5 %').first()).toBeVisible();
  await page.getByRole('button', { name: 'Додати до дня', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Сьогодні' })).toBeVisible();
  await page.goto('./#/meal/new');
  await expect(page.getByRole('button', { name: 'Додати до дня', exact: true })).toBeDisabled();
});
