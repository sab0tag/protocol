import { expect, test } from '@playwright/test';
import { atLocalNoon, device } from './helpers';

test('Today separates actions, quantities and history across all approved widths and themes', async ({ browser }) => {
  const page = await device(browser);
  await atLocalNoon(page);
  const counter = page.getByTestId('remaining-actions');
  await expect(counter).toBeVisible();
  const before = await counter.textContent();
  await page.getByRole('navigation', { name: 'Швидкі дії', exact: true }).getByRole('button', { name: '+250 мл', exact: true }).click();
  await expect(counter).toHaveText(before!); // Quantitative water progress is not an execution score.
  await expect(page.locator('.protocol-day-hero')).toHaveCount(0);
  await expect(page.getByTestId('daily-phrase')).toHaveCount(0);
  const goals = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Цілі на сьогодні' }) });
  const history = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Виконано та інші відмітки' }) });
  await expect(history).not.toHaveAttribute('open');
  await history.locator('summary').click();
  await expect(history.getByRole('button', { name: /^Вода, Виконано/ })).toBeVisible();
  await history.locator('summary').click();
  await expect(goals).toHaveAttribute('open');
  await goals.locator('summary').focus();
  await page.keyboard.press('Space');
  await expect(goals).not.toHaveAttribute('open');
  await page.keyboard.press('Space');
  await expect(goals).toHaveAttribute('open');
  await expect(goals.locator('.protocol-ring')).toHaveCount(0);
  for (const colorScheme of ['light', 'dark'] as const) for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${colorScheme}`).toBe(true);
    const action = page.getByRole('region', { name: 'Зараз', exact: true }).getByRole('button', { name: 'Відмітити прийом', exact: true });
    const contrast = await action.evaluate(element => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      const a = luminance(style.color), b = luminance(style.backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(contrast, `primary action ${colorScheme}`).toBeGreaterThanOrEqual(4.5);
    const [schedule, quantities, records] = await Promise.all([
      page.getByRole('region', { name: 'Далі за планом', exact: true }).boundingBox(), goals.boundingBox(), history.boundingBox(),
    ]);
    expect(schedule!.y).toBeLessThan(quantities!.y);
    expect(quantities!.y).toBeLessThan(records!.y);
    await page.locator('h1').click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `test-results/today-redesign-${width}-${colorScheme}.png`, fullPage: true });
  }
  await page.getByText('Обрати день', { exact: true }).click();
  const week = page.getByRole('navigation', { name: 'Тиждень' });
  for (const button of await week.getByRole('button').all()) {
    const size = await button.boundingBox();
    expect(size!.width).toBeGreaterThanOrEqual(44);
    expect(size!.height).toBeGreaterThanOrEqual(44);
  }
  await page.context().close();
});
