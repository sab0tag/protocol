import { expect, test } from '@playwright/test';
import { device } from './helpers';
test('profile name updates immediately and each person can control the daily phrase', async ({ browser }) => {
  const page = await device(browser, 'skip'); await page.goto('./#/profiles');
  await page.getByRole('button', { name: 'Редагувати профіль: Мій профіль', exact: true }).click();
  await page.getByLabel('Ім’я', { exact: true }).fill('Олена');
  const toggle = page.getByRole('checkbox', { name: 'Мотиваційна фраза щодня', exact: true });
  await expect(toggle).toBeChecked(); await toggle.focus(); await page.keyboard.press('Space'); await expect(toggle).not.toBeChecked();
  for (const width of [320, 1024]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(toggle).not.toBeChecked();
    await page.screenshot({ path: `test-results/profile-setting-${width}-${colorScheme}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Зберегти профіль', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Редагувати профіль: Олена', exact: true })).toBeVisible();
  await page.goto('./#/'); await expect(page.getByTestId('greeting')).toContainText('Олена');
  await expect(page.getByTestId('daily-phrase')).toHaveCount(0);
  await page.reload(); await expect(page.getByTestId('daily-phrase')).toHaveCount(0);
  await page.getByTestId('greeting').click(); await page.getByRole('button', { name: 'Додати профіль', exact: true }).click();
  await page.getByLabel('Ім’я', { exact: true }).fill('Данило'); await expect(toggle).toBeChecked();
  await page.getByRole('button', { name: 'Зберегти профіль', exact: true }).click();
  await page.getByRole('button', { name: 'Відкрити профіль: Данило', exact: true }).click();
  await page.getByRole('button', { name: /^Пропустити/ }).click();
  await expect(page.getByTestId('greeting')).toContainText('Данило'); await expect(page.getByTestId('daily-phrase')).toBeVisible();
  await page.goto('./?protocol-profile=main#/'); await expect(page.getByTestId('daily-phrase')).toHaveCount(0);
  await page.getByTestId('greeting').click(); await page.getByRole('button', { name: 'Редагувати профіль: Олена', exact: true }).click();
  await toggle.check(); await page.getByRole('button', { name: 'Зберегти профіль', exact: true }).click();
  await page.goto('./#/'); await expect(page.getByTestId('daily-phrase')).toBeVisible();
  await page.context().close();
});

test('renaming updates other open tabs without reloading their current work', async ({ browser }) => {
  const page = await device(browser, 'skip'); await page.goto('./#/profiles');
  await page.getByRole('button', { name: 'Редагувати профіль: Мій профіль', exact: true }).click();
  await page.getByLabel('Ім’я', { exact: true }).fill('Марія'); await page.getByRole('button', { name: 'Зберегти профіль', exact: true }).click();
  const other = await page.context().newPage(); await other.goto('./#/');
  await expect(other.getByTestId('greeting')).toContainText('Марія');
  await other.evaluate(() => { (window as unknown as Record<string, unknown>).testProfileMarker = 'keep'; });
  await page.getByRole('button', { name: 'Редагувати профіль: Марія', exact: true }).click();
  await page.getByLabel('Ім’я', { exact: true }).fill('Марічка'); await page.getByRole('button', { name: 'Зберегти профіль', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Редагувати профіль: Марічка', exact: true })).toBeVisible();
  await expect(other.getByTestId('greeting')).toContainText('Марічка');
  expect(await other.evaluate(() => (window as unknown as Record<string, unknown>).testProfileMarker)).toBe('keep');
  await page.context().close();
});
