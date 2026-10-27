import { expect, test } from '@playwright/test';
import { t } from '../../src/i18n/uk';
import { device, kyivOffset, seed, syncOn, ymd } from './helpers';

test('forest stays available offline; primary action and honest meters remain usable on a narrow phone', async ({ browser }) => {
  const page = await device(browser);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await seed(page, [
    { store: 'entries', value: { id: 'forest-water', at: `${ymd(new Date())}T09:00:00${kyivOffset()}`, kind: 'water', status: 'done', title: t.addKinds.water, waterMl: 3000 } },
    { store: 'entries', value: { id: 'forest-food', at: `${ymd(new Date())}T09:10:00${kyivOffset()}`, kind: 'meal', status: 'done', title: 'Тестовий запис', items: [{ name: 'Власний продукт', grams: 100, manual: { kcal: 900, protein: 0, fat: 0, carbs: 230, calciumMg: 0 } }] } },
  ]);
  const action = page.getByRole('button', { name: t.day.recordFood, exact: true });
  await expect(action).toBeInViewport();
  const summary = page.getByRole('region', { name: t.summary.title });
  const water = summary.getByRole('progressbar', { name: t.summary.water });
  await expect(water).toHaveAttribute('aria-valuenow', '100');
  await expect(water).toHaveAttribute('aria-valuetext', '3 / 2,5 л');
  const carbs = summary.getByRole('progressbar', { name: t.summary.carbs });
  await expect(carbs).toHaveAttribute('aria-valuenow', '100');
  await expect(carbs).toHaveAttribute('aria-valuetext', /230 г.*190.*40/);
  const boxes = await Promise.all([summary.boundingBox(), page.getByRole('region', { name: 'Найближче' }).boundingBox()]);
  expect(boxes[1]!.y).toBeLessThan(boxes[0]!.y);
  const background = await page.locator('.protocol-day-hero').evaluate((el) => getComputedStyle(el).backgroundImage);
  const asset = /url\("?([^"\)]+\.webp)"?\)/.exec(background)?.[1];
  expect(asset).toBeTruthy();
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Сьогодні', exact: true })).toBeVisible();
  expect(await page.evaluate(async (url) => (await fetch(url!)).ok, asset)).toBe(true);
  await page.screenshot({ path: 'test-results/forest-today-320-dark.png', fullPage: true });
  await page.context().close();
});

test('native toggles work by keyboard and preserve plan and reminder settings after reload', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/plan/constraints');
  const restriction = page.getByRole('checkbox', { name: /Оксалатні камені:/ });
  await expect(restriction).toBeChecked();
  await restriction.focus();
  await page.keyboard.press('Space');
  await expect(restriction).not.toBeChecked();
  await page.reload();
  await expect(restriction).not.toBeChecked();
  await syncOn(page);
  await page.goto('./#/reminders');
  const meals = page.getByRole('checkbox', { name: t.remind.meals, exact: true });
  const before = await meals.isChecked();
  await meals.focus();
  await page.keyboard.press('Space');
  await expect(meals).toBeChecked({ checked: !before });
  await page.reload();
  await expect(meals).toBeChecked({ checked: !before });
  await page.screenshot({ path: 'test-results/forest-reminders.png', fullPage: true });
  await page.context().close();
});

test('metrics without plan targets show values without a made-up completion percentage', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const summary = page.getByRole('region', { name: t.summary.title });
  await expect(summary.getByRole('progressbar')).toHaveCount(0);
  await summary.getByRole('button', { name: t.summary.all }).click();
  await expect(summary.getByRole('progressbar')).toHaveCount(0);
  await expect(summary.getByText(t.summary.protein, { exact: true })).toBeVisible();
  await page.context().close();
});

test('working screens fit phone and desktop in both themes', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await device(browser, 'demo');
  const routes = ['', 'meal/new', 'plan', 'plan/prescriptions', 'plan/constraints', 'plan/goals', 'plan/checkup', 'plan/scan', 'plan/history', 'progress', 'progress/motivation', 'progress/insights', 'progress/labs', 'more', 'more/health', 'more/settings', 'wellbeing', 'wellbeing/journal', 'my-day', 'week', 'assistant', 'reminders', 'sync', 'dishes', 'shopping', 'workout', 'exercises', 'menu', 'foods', 'data', 'quick', 'about', 'frictions', 'pilot', 'concierge-log'];
  for (const [width, height, colorScheme] of [[320, 568, 'dark'], [390, 844, 'light'], [1024, 768, 'dark']] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme });
    for (const route of routes) {
      await page.goto(`./#/${route}`);
      // A fresh document avoids accidentally inspecting the previous route while React changes screens.
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route || 'today'} at ${width}`).toBe(true);
      await expect(page.getByRole('navigation', { name: 'Розділи', exact: true })).toBeVisible();
      if (['', 'meal/new', 'plan', 'progress', 'more', 'wellbeing', 'assistant'].includes(route)) {
        await page.screenshot({ path: `test-results/forest-${route.replaceAll('/', '-') || 'today'}-${width}-${colorScheme}.png`, fullPage: true });
      }
    }
  }
  await page.context().close();
});
