import { expect, test } from '@playwright/test';
import { atLocalNoon, device } from './helpers';

test('Today separates actions, quantities and history across all approved widths and themes', async ({ browser }) => {
  const page = await device(browser);
  await atLocalNoon(page);
  await expect(page.getByTestId('remaining-actions')).toHaveCount(0); // D160: no «За планом: N без відмітки» chip in the header
  // D164: water is a quick mark; the done record is struck through in the day list; no «Цілі на сьогодні», no history to open
  await page.getByRole('navigation', { name: 'Швидкі відмітки', exact: true }).getByRole('button', { name: /^Вода:/ }).click();
  await expect(page.locator('.protocol-day-hero')).toHaveCount(0);
  await expect(page.getByTestId('daily-phrase')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Швидкі відмітки', exact: true }).getByRole('button', { name: /^Вода:/ })).toHaveAccessibleName(/^Вода: 1 з \d+$/);
  await expect(page.getByText('Цілі на сьогодні')).toHaveCount(0);
  await expect(page.getByText(/^Виконано та інші відмітки/)).toHaveCount(0);
  for (const colorScheme of ['light', 'dark'] as const) for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${colorScheme}`).toBe(true);
    const action = page.getByRole('region', { name: 'Зараз', exact: true }).getByRole('button', { name: /Прийнято/ });
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
    const [now, marks, food] = await Promise.all([page.getByRole('region', { name: 'Зараз', exact: true }).boundingBox(),
      page.getByTestId('quick-marks').boundingBox(), page.getByTestId('meal-tiles').boundingBox()]);
    expect(now!.y).toBeLessThan(marks!.y); expect(marks!.y).toBeLessThan(food!.y); // the order of the first screen
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `test-results/today-redesign-${width}-${colorScheme}.png`, fullPage: true });
  }
  await page.locator('button[aria-controls="day-week"]').click(); // D160: a tap on the date opens the week
  const week = page.getByRole('navigation', { name: 'Тиждень' });
  for (const button of await week.getByRole('button').all()) {
    const size = await button.boundingBox();
    expect(size!.width).toBeGreaterThanOrEqual(44);
    expect(size!.height).toBeGreaterThanOrEqual(44);
  }
  await page.context().close();
});
