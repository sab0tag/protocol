import { expect, test } from '@playwright/test';
import { t } from '../../src/i18n/uk';
import { device, kyivOffset, seed, ymd } from './helpers';

test('water has no action under quick tiles and the floating action still adds, accumulates and undoes records', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.setViewportSize({ width: 320, height: 568 });
  const dock = page.getByRole('group', { name: t.dock.label });
  const water = dock.getByRole('button', { name: /Додати 250 мл води/ });
  await expect(water).not.toBeVisible();
  await expect(page.getByText('+250 мл', { exact: true })).toHaveCount(0);
  await page.getByRole('region', { name: t.summary.title, exact: true }).scrollIntoViewIfNeeded();
  await expect(water).toBeVisible();
  await expect(dock.getByText(t.summary.water, { exact: true })).toHaveCount(0);
  await water.click();
  await expect(page.getByText('0,25 л', { exact: true })).toHaveCount(1);
  await expect(dock.getByText('250 мл', { exact: true })).toHaveCount(0);
  await water.click();
  await expect(page.getByText('0,5 л', { exact: true })).toHaveCount(1);
  await expect(dock.getByRole('status')).toContainText('+500 мл');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dock.getByRole('button', { name: t.toast.undo, exact: true }).click();
  await expect(page.getByText('0 л', { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByText('0 л', { exact: true })).toHaveCount(1);
  await page.context().close();
});

test('colored rings keep the selected metrics, actual values and working SVG gradients across responsive themes', async ({ browser }) => {
  const page = await device(browser);
  const at = `${ymd(new Date())}T09:00:00${kyivOffset()}`;
  await seed(page, [
    { store: 'entries', value: { id: 'colored-water', at, kind: 'water', status: 'done', title: t.addKinds.water, waterMl: 500 } },
    { store: 'entries', value: { id: 'colored-food', at, kind: 'meal', status: 'done', title: 'Перевірка дизайну', items: [
      { name: 'Тестовий продукт', grams: 100, manual: { kcal: 366, protein: 23, fat: 8, carbs: 32, calciumMg: 100 } },
    ] } },
  ]);
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
  }
  for (const [width, height, colorScheme] of [[320, 568, 'dark'], [390, 844, 'dark'], [1024, 768, 'light']] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme });
    await summary.scrollIntoViewIfNeeded();
    const colors = await summary.getByRole('progressbar').evaluateAll((rings) => rings.map((ring) => {
      const path = ring.querySelector('circle[stroke^="url"]')!;
      const id = path.getAttribute('stroke')!.slice(5, -1);
      const gradient = document.getElementById(id);
      const color = getComputedStyle(ring.querySelector('.protocol-ring-icon')!).color.match(/\d+/g)!.map(Number);
      return { color, gradient: gradient?.tagName.toLowerCase(), id };
    }));
    expect(colors.every((x) => x.gradient === 'lineargradient')).toBe(true);
    expect(new Set(colors.map((x) => x.id)).size).toBe(3);
    const [orange, green, blue] = colors.map((x) => x.color);
    expect(orange![0]).toBeGreaterThan(orange![1]!);
    expect(green![1]).toBeGreaterThan(green![0]!);
    expect(blue![2]).toBeGreaterThan(blue![0]!);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await summary.screenshot({ path: `test-results/colored-summary-${width}-${colorScheme}.png` });
  }
  await page.context().close();
});
