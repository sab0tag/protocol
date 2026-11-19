// D183 (task 8): «Ціль щодо ваги» — numbers by the code; stop conditions give no number; the own goal beside the doctor's.
import { expect, test } from '@playwright/test';
import { device } from './helpers';

test('the control case on screen, saved as my goal, in «Мій план» and in the report as «Що я задав сам» (D183)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/goal');
  const g = page.getByTestId('weight-goal');
  await g.getByLabel('Вік, років').fill('41');
  await g.getByLabel('Зріст, см').fill('187');
  await g.getByLabel('Вага зараз, кг').fill('97');
  await g.getByLabel('Бажана вага, кг').fill('87');
  await g.getByLabel('Кроків на день').fill('5000');
  await g.getByLabel('Хвилин тренувань на тиждень').fill('60');
  const result = g.getByTestId('goal-result');
  const kcal = Number((await result.locator('p').first().textContent())!.match(/\d+/)![0]);
  expect(kcal).toBeGreaterThanOrEqual(1700); expect(kcal).toBeLessThanOrEqual(1900); // not Calorize's 2276
  await expect(result).toContainText('×1,27: 5000 кроків на день, 60 хв тренувань на тиждень');
  await expect(result).toContainText('Білок — 116–155 г на день');
  await result.getByRole('button', { name: '−300 (повільно)' }).click();
  await expect(result).toContainText(/менше, ніж коливання ваги; перший результат побачите через ~\d+ тижн/);
  await result.getByRole('button', { name: '−600' }).click();
  await result.getByRole('button', { name: 'Зберегти як мою ціль' }).click();
  await expect(g.getByTestId('own-goal')).toContainText('Моя ціль: 87 кг');
  await expect(g.getByTestId('own-goal')).toContainText('Ваша ціль, не призначення лікаря');
  await page.goto('./#/plan/goals');
  await expect(page.getByTestId('goal-link')).toContainText('Моя ціль: 87 кг');
  await page.goto('./#/report');
  await expect(page.getByTestId('report-own-goal')).toContainText('Що я задав сам (не призначення лікаря): ціль 87 кг');
});

test('stop conditions: no number at all — «спершу з лікарем»; words of distress — a soft word about a specialist (D183)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/goal');
  const g = page.getByTestId('weight-goal');
  await g.getByLabel('Стать').selectOption({ label: 'Жінка' });
  for (const [label, value] of [['Вік, років', '30'], ['Зріст, см', '168'], ['Вага зараз, кг', '80'], ['Бажана вага, кг', '70']]) await g.getByLabel(label!).fill(value!);
  await expect(g.getByTestId('goal-result')).toBeVisible();
  await g.getByLabel('Вагітність або годування груддю').check();
  await expect(g.getByTestId('goal-stop')).toContainText('Ціль щодо ваги — спершу з лікарем');
  await expect(g.getByTestId('goal-result')).toHaveCount(0);
  await expect(g.getByText(/ккал на день/)).toHaveCount(0); // not one number
  await g.getByLabel('Вагітність або годування груддю').uncheck();
  await g.getByLabel(/Що вас турбує в харчуванні/).fill('часто переїдаю, а потім відчуваю провину');
  await expect(g.getByTestId('goal-stop')).toContainText('Здається, вам зараз непросто з їжею');
  await expect(g.getByText(/ккал на день/)).toHaveCount(0);
});
