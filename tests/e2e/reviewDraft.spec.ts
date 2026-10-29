import { expect, test, type Page } from '@playwright/test';
import { device, toast } from './helpers';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
async function startReview(page: Page) {
  await page.route('**/conclusion', r => r.fulfill({ json: {
    readable: true, date: '2026-10-26', doctor: 'Лікар', diagnosis: null, note: null, diet: null,
    constraints: [], targets: [], tests: [], nextVisit: null, unread: [], prescriptions: [{ kind: 'medication', title: 'Тестове призначення', dose: '1 таб.', durationDays: null, withFood: true, page: 1, box: [0.1, 0.3, 0.6, 0.05], sure: 'yes', times: [], perDay: 2, frequency: '2 рази на день', asNeeded: false }],
  } }));
  await page.goto('./#/plan/scan'); await page.getByRole('button', { name: 'Фото висновку лікаря' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Дозволити й вибрати фото' }).click()]);
  await chooser.setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Надіслати', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Час прийому: Тестове призначення', exact: true });
  await input.fill('08:15, 20:30');
  await expect(page.getByText('Чернетку збережено на пристрої', { exact: true })).toBeVisible();
  return input;
}
test('review survives reload, requires fresh confirmation, and is consumed atomically on activation', async ({ browser }) => {
  const page = await device(browser, 'skip', { sw: false }); await startReview(page);
  await page.getByRole('checkbox', { name: 'Тестове призначення 1 таб.', exact: true }).check();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Незавершена перевірка' })).toBeVisible();
  for (const width of [320, 1024]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    await expect(page.getByRole('button', { name: 'Продовжити перевірку', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/recover-review-${width}-${colorScheme}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Продовжити перевірку', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Час прийому: Тестове призначення', exact: true })).toHaveValue('08:15, 20:30');
  const checkbox = page.getByRole('checkbox', { name: 'Тестове призначення 1 таб.', exact: true });
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Внести в план (0)', exact: true })).toBeDisabled();
  await checkbox.check();
  await page.getByRole('button', { name: 'Зберегти на потім', exact: true }).click();
  await page.getByRole('button', { name: 'Продовжити перевірку', exact: true }).click();
  await expect(checkbox).not.toBeChecked(); await checkbox.check();
  await page.getByRole('button', { name: 'Внести в план (1)', exact: true }).click();
  await expect(page).toHaveURL(/#\/plan$/);
  await page.goto('./#/plan/scan'); await page.reload();
  await expect(page.getByRole('region', { name: 'Незавершена перевірка' })).toHaveCount(0);
  await page.goto('./#/plan/prescriptions');
  await expect(page.getByText('Тестове призначення', { exact: true })).toHaveCount(1);
  await expect(page.getByText(/08:15, 20:30/)).toBeVisible();
  await page.context().close();
});
test('a stale tab cannot replace or activate a newer review', async ({ browser }) => {
  const page = await device(browser, 'skip', { sw: false }); const input = await startReview(page);
  const other = await page.context().newPage(); await other.goto('./#/plan/scan');
  await other.getByRole('button', { name: 'Продовжити перевірку', exact: true }).click();
  await other.getByRole('textbox', { name: 'Час прийому: Тестове призначення', exact: true }).fill('09:15, 21:30');
  await expect(other.getByText('Чернетку збережено на пристрої', { exact: true })).toBeVisible();
  await input.fill('10:15, 22:30');
  await expect(page.getByText(/Чернетку змінено в іншій вкладці/)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Тестове призначення 1 таб.', exact: true }).check();
  await page.getByRole('button', { name: 'Внести в план (1)', exact: true }).click();
  await expect(toast(page)).toContainText('Не вдалося');
  await page.reload(); await page.getByRole('button', { name: 'Продовжити перевірку', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Час прийому: Тестове призначення', exact: true })).toHaveValue('09:15, 21:30');
  await page.context().close();
});
