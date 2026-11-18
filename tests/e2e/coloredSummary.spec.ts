import { expect, test } from '@playwright/test';
import { t } from '../../src/i18n/uk';
import { device, kyivOffset, seed, ymd } from './helpers';

test('the water tile counts litres (D169) at 320 px with undo; «Мій прогрес» shows the litres, kept after a reload (D164)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.setViewportSize({ width: 320, height: 568 });
  const water = page.getByRole('navigation', { name: 'Швидкі відмітки', exact: true }).getByRole('button', { name: /^Вода:/ });
  await water.click();
  await expect(page.getByRole('status').getByRole('button', { name: t.toast.undo, exact: true })).toBeVisible();
  await water.click();
  await expect(water).toHaveAccessibleName(/^Вода: 0,5 л/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('status').getByRole('button', { name: t.toast.undo, exact: true }).click();
  await expect(water).toHaveAccessibleName(/^Вода: 0,25 л/);
  await page.reload();
  await expect(water).toHaveAccessibleName(/^Вода: 0,25 л/);
  await page.goto('./#/progress');
  await expect(page.getByRole('region', { name: t.summary.title, exact: true }).getByText(/^0,25/)).toBeVisible();
  await page.context().close();
});

test('compact tracks keep selected metrics, actual values and distinct gradients across responsive themes', async ({ browser }) => {
  const page = await device(browser);
  const at = `${ymd(new Date())}T09:00:00${kyivOffset()}`;
  await seed(page, [
    { store: 'entries', value: { id: 'colored-water', at, kind: 'water', status: 'done', title: t.addKinds.water, waterMl: 500 } },
    { store: 'entries', value: { id: 'colored-food', at, kind: 'meal', status: 'done', title: 'Перевірка дизайну', items: [
      { name: 'Тестовий продукт', grams: 100, manual: { kcal: 366, protein: 23, fat: 8, carbs: 32, calciumMg: 100 } },
    ] } },
  ]);
  await page.goto('./#/progress'); // D164: the day's goals live in «Мій прогрес»
  const summary = page.getByRole('region', { name: t.summary.title });
  await summary.getByRole('button', { name: t.summary.setup }).click();
  await summary.getByRole('checkbox', { name: t.summary.meds, exact: true }).uncheck();
  await summary.getByRole('checkbox', { name: t.summary.kcal, exact: true }).check();
  await summary.getByRole('checkbox', { name: t.summary.water, exact: true }).uncheck();
  await summary.getByRole('checkbox', { name: t.summary.protein, exact: true }).check();
  await summary.getByRole('checkbox', { name: t.summary.carbs, exact: true }).uncheck();
  await summary.getByRole('checkbox', { name: t.summary.water, exact: true }).check();
  await summary.getByRole('button', { name: t.summary.done }).click();
  await page.reload();
  for (const [label, percent, value] of [[t.summary.kcal, '17', '366 / 2100 ккал'], [t.summary.protein, '16', '23 / 140 г'], [t.summary.water, '20', '0,5 / 2,5 л']]) {
    const ring = summary.getByRole('progressbar', { name: label, exact: true });
    await expect(ring).toHaveAttribute('aria-valuenow', percent);
    await expect(ring).toHaveAttribute('aria-valuetext', value);
    await expect(summary.getByText(value, { exact: true })).toHaveCount(1);
    await expect(summary.getByText(`${percent}%`, { exact: true })).toHaveCount(0);
    const track = await ring.boundingBox();
    expect(track!.height).toBeLessThanOrEqual(10);

  }
  for (const width of [320, 390, 768, 1024]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme });
      await summary.scrollIntoViewIfNeeded();
      const colors = await summary.getByRole('listitem').evaluateAll((items) => items.map((item) => {
        const track = item.querySelector('[role="progressbar"]')!;
        const fill = track.querySelector('.protocol-progress-fill')!;
        const color = getComputedStyle(track).getPropertyValue('--progress-color').trim().split(/\s+/).map(Number);
        return { color, gradient: getComputedStyle(fill).backgroundImage };
      }));
      expect(colors.every(x => x.gradient.includes('linear-gradient'))).toBe(true);
      expect(new Set(colors.map(x => x.color.join(','))).size).toBe(3);
      const [orange, green, blue] = colors.map((x) => x.color);
      expect(orange![0]).toBeGreaterThan(orange![1]!);
      expect(green![1]).toBeGreaterThan(green![0]!);
      expect(blue![2]).toBeGreaterThan(blue![0]!);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await summary.screenshot({ path: `test-results/colored-summary-${width}-${colorScheme}.png` });
    }
  }
  await page.context().close();
});
