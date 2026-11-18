import { expect, test } from '@playwright/test';
import { device } from './helpers';

// D165 (ТЗ «спрощення» 17.11, step 4): «Результати» is the week in one phrase, three numbers and the doctor's report as the
// main action — counted from the records against the plan, never a combined health score; the report still leaves the
// device only after its own explicit consent (D158). Patterns, motivation and the rest are links.

test('the week in one phrase and three numbers; «Звіт для лікаря» is the main action; the rest are links', async ({ browser }) => {
  const page = await device(browser, 'demo'); // weights, wellbeing, workouts and a plan, in a database of its own
  await page.goto('./#/progress');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Результати');
  await expect(page.locator('.protocol-scene-header')).toHaveCount(0);
  const week = page.getByRole('region', { name: /^Тиждень \d\d\.\d\d–\d\d\.\d\d$/ });
  await expect(week.getByTestId('week-phrase')).toHaveText(/^Ліки — \d+ з \d+, їжа за планом \d+ (день|дні|днів) з 7$/);
  const numbers = week.locator('dl > div');
  await expect(numbers).toHaveCount(3);
  await expect(numbers.first()).toContainText(/Ліки\s*\d+ з \d+/);
  await expect(week.getByRole('progressbar')).toHaveCount(0); // no score, no rings in the week (today's goals below keep their bars, D164)
  const report = page.getByRole('link', { name: 'Звіт для лікаря' });
  await expect(report).toHaveClass(/protocol-action/);
  const more = page.getByRole('navigation', { name: 'Докладніше' });
  for (const [name, url] of [['Тиждень докладно', /#\/week$/], ['Інсайти', /#\/progress\/insights$/], ['Мотивація', /#\/progress\/motivation$/]] as const) {
    await more.getByRole('link', { name }).click(); await expect(page).toHaveURL(url); await page.goBack();
  }
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), { message: `overflow at ${width}px` }).toBeLessThanOrEqual(0);
  }
  await page.context().close();
});

test('the report opened from «Результати» is not shared until consent is given', async ({ browser }) => {
  const page = await device(browser, 'demo');
  await page.goto('./#/progress');
  await page.getByRole('link', { name: 'Звіт для лікаря' }).click();
  await expect(page).toHaveURL(/#\/report$/);
  await page.evaluate(() => { document.body.dataset.shareCalls = '0'; Object.defineProperty(navigator, 'share', { configurable: true,
    value: async () => { document.body.dataset.shareCalls = String(Number(document.body.dataset.shareCalls) + 1); } }); });

  await page.getByRole('button', { name: 'Поділитися', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Підтвердження передачі' });
  await expect(panel.getByRole('button', { name: 'Передати звіт', exact: true })).toBeDisabled();
  await expect(panel.getByRole('checkbox', { name: /Я погоджуюсь передати/ })).not.toBeChecked();
  expect(await page.locator('body').getAttribute('data-share-calls')).toBe('0');
  await page.context().close();
});
