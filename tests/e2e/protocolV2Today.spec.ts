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

test('the example-data warning appears before the example schedule', async ({ browser }) => {
  const page = await device(browser);
  const warning = page.getByRole('status').filter({ hasText: 'Це приклад:' });
  const schedule = page.getByRole('region', { name: /^(Зараз|Не відмічено|Найближче)$/ }).first();
  await expect(warning).toBeVisible();
  await expect(schedule).toBeVisible();
  const [warningBox, scheduleBox] = await Promise.all([warning.boundingBox(), schedule.boundingBox()]);
  if (!warningBox || !scheduleBox) throw new Error('The warning and schedule must have visible bounds');
  expect(warningBox.y).toBeLessThan(scheduleBox.y);
});

test('the example-data warning appears before My Day checklist actions', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/my-day');
  const warning = page.getByRole('status').filter({ hasText: 'Це приклад:' });
  const checklist = page.getByRole('progressbar', { name: 'Мій день' });
  await expect(warning).toBeVisible();
  await expect(checklist).toBeVisible();
  const [warningBox, checklistBox] = await Promise.all([warning.boundingBox(), checklist.boundingBox()]);
  if (!warningBox || !checklistBox) throw new Error('The warning and checklist must have visible bounds');
  expect(warningBox.y).toBeLessThan(checklistBox.y);
});

test('example-data warning is shown on screens that edit or summarize sample data', async ({ browser }) => {
  const page = await device(browser);
  for (const route of ['/meal/new', '/workout', '/week', '/progress/insights', '/progress/motivation', '/wellbeing', '/wellbeing/journal']) {
    await page.goto(`./#${route}`);
    await expect(page.getByRole('status').filter({ hasText: 'Це приклад:' }), route).toBeVisible();
  }
});
