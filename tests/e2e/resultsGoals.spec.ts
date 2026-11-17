import { expect, test } from '@playwright/test';
import { device } from './helpers';

// UI-RESULTS-01: «Результати» keeps what was measured and recorded apart from how the records kept the plan's goals,
// with no combined score, and the doctor's report still leaves the device only after its own explicit consent (D158).

test('results and plan goals are two separate parts with no combined score', async ({ browser }) => {
  const page = await device(browser, 'demo'); // weights, wellbeing, workouts and a plan, in a database of its own
  await page.goto('./#/progress');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Результати');
  await expect(page.locator('.protocol-scene-header')).toHaveCount(0); // the plain mint heading, no photo

  const recorded = page.getByRole('region', { name: 'Вимірювання і записи' });
  const goals = page.getByRole('region', { name: 'Цілі плану' });
  // Recorded values are not measured against a goal: no goal rings among them
  await expect(recorded.getByRole('article')).toHaveCount(3);
  await expect(recorded.getByRole('progressbar')).toHaveCount(0);
  await expect(recorded).toContainText('без порівняння з цілями');
  // Goals hold only what is counted against the plan; the records themselves are not repeated there
  await expect(goals.getByRole('progressbar', { name: 'План дня' })).toBeVisible();
  await expect(goals.getByRole('article')).toHaveCount(0);
  await expect(goals.locator('li.protocol-week-metric').filter({ hasText: 'Тренувань' })).toHaveCount(0);
  await expect(goals).toContainText('Це не оцінка здоров’я');
  // One place for the plan's daily percentage, not two
  await expect(page.getByRole('progressbar', { name: 'План дня' })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'План', exact: true })).toHaveCount(0);

  // Recorded first, goals after it, the sections' links last
  const r = (await recorded.boundingBox())!, g = (await goals.boundingBox())!;
  expect(g.y).toBeGreaterThanOrEqual(r.y + r.height);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.context().close();
});

test('the report opened from «Результати» is not shared until consent is given', async ({ browser }) => {
  const page = await device(browser, 'demo');
  await page.goto('./#/progress');
  await expect(page.getByText('Передати його лікарю можна лише після вашої згоди.')).toBeVisible();
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
