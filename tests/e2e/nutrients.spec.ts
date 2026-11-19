import { expect, test } from '@playwright/test';
import { device, kyivOffset, seed, ymd } from './helpers';
import { emptyPlan } from '../../src/data/seed.example';
import { t } from '../../src/i18n/uk';

// D188 («Очередь агента», задача 10): the plan limits salt — «сіль ~… г з 5» on «Харчування» and in the open tile, always;
// the other three folded; a free line's calories checked against its macros, salt typed in grams.

test('the plan limits salt: the day\'s salt against it on «Харчування» and in the open tile; the rest folded', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const d = ymd(new Date());
  await seed(page, [
    { store: 'plan', value: { ...emptyPlan(), id: 'main', onboardedAt: d,
      constraints: [{ id: 'salt', tag: 'sodium', active: true, title: 'Сіль до 5 г на день', reason: '', source: 'лікар' }] } },
    { store: 'entries', value: { id: 'lunch-1', at: `${d}T13:00:00${kyivOffset()}`, kind: 'meal', status: 'done', title: 'Обід',
      items: [{ foodId: 'bread-rye', name: 'Хліб житній', grams: 100 }] } }, // 603 mg sodium — 1.5 g salt
  ]);
  await page.goto('./#/food');
  await expect(page.getByTestId('salt-row')).toContainText('сіль ~1,5 г з 5');
  await page.getByTestId('more-nutrients').getByText(t.nutrients.more).click();
  await expect(page.getByTestId('more-nutrients')).toContainText(t.nutrients.fiber);
  await expect(page.getByTestId('more-nutrients').locator('li').filter({ hasText: t.nutrients.salt })).toHaveCount(0); // salt is already above, not twice

  await page.goto('./#/');
  const lunch = page.locator('[data-testid=meal-tiles] [data-slot="1"]');
  await lunch.getByRole('button', { name: /^Обід/ }).click();
  await expect(lunch.getByTestId('tile-salt')).toHaveText('сіль ~1,5 г з 5');
});

test('a free line: no kcal — counted from the macros; far off — «Перевірте»; salt in grams in «Більше нутрієнтів»', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/meal/new?slot=1');
  await page.getByText(t.meal.moreEntryMethods, { exact: true }).click();
  await page.getByRole('button', { name: t.meal.free }).click();
  await page.locator('[data-field=protein]').fill('10');
  await page.locator('[data-field=fat]').fill('5');
  await page.locator('[data-field=carbs]').fill('20');
  await expect(page.getByTestId('kcal-from-macros')).toHaveText(t.nutrients.kcalFromMacros(165));
  await page.locator('[data-field=kcal]').fill('300');
  await expect(page.getByTestId('kcal-check')).toHaveText(t.nutrients.kcalCheck(165));
  await page.locator('[data-field=kcal]').fill('170');
  await expect(page.getByTestId('kcal-check')).toHaveCount(0); // within 20 % — no remark, and never a block
  await page.getByText(t.nutrients.more, { exact: true }).click();
  await expect(page.locator('[data-field=saltG]')).toBeVisible();
});
