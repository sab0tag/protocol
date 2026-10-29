import { expect, test } from '@playwright/test';
import { device } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

test('import never invents times, rejects incomplete clocks, and revokes a confirmation after editing', async ({ browser }) => {
  const page = await device(browser, 'skip', { sw: false });
  const source = { kind: 'medication', dose: '1 таб.', durationDays: null, withFood: true, page: 1, box: [0.1, 0.3, 0.6, 0.05], sure: 'yes' };
  await page.route('**/conclusion', (r) => r.fulfill({ json: {
    readable: true, date: '2026-10-26', doctor: 'Лікар', diagnosis: null, note: null, diet: null,
    constraints: [], targets: [], tests: [], nextVisit: null, unread: [], prescriptions: [
      { ...source, title: 'Без часу', times: [], perDay: 2, frequency: '2 рази на день', asNeeded: false },
      { ...source, title: 'Нерозбірливий час', times: ['07:00', 'ввечері'], perDay: 2, frequency: '2 рази на день', asNeeded: false },
      { ...source, title: 'За потреби', times: [], perDay: null, frequency: 'при болю', asNeeded: true },
    ],
  } }));
  await page.goto('./#/plan/scan');
  await page.getByRole('button', { name: 'Фото висновку лікаря' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Дозволити й вибрати фото' }).click()]);
  await chooser.setFiles({ name: 'page.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Надіслати', exact: true }).click();
  const form = page.getByRole('region', { name: /^Ось що я прочитав/ });
  const first = form.getByRole('checkbox', { name: 'Без часу 1 таб.', exact: true });
  const input = form.getByRole('textbox', { name: 'Час прийому: Без часу', exact: true });
  const second = form.getByRole('checkbox', { name: 'Нерозбірливий час 1 таб.', exact: true });
  const badSource = form.getByRole('textbox', { name: 'Час прийому: Нерозбірливий час', exact: true });
  await expect(input).toHaveValue('');
  await expect(first).toBeDisabled();
  await expect(badSource).toHaveValue('07:00, ввечері'); // the unparsed slot is visible, not silently dropped
  await expect(second).toBeDisabled();
  await expect(form.getByRole('textbox', { name: 'Час прийому: За потреби', exact: true })).toHaveCount(0);
  await expect(form.getByRole('checkbox', { name: 'За потреби 1 таб.', exact: true })).toBeEnabled();
  for (const raw of ['08:15', '08:15, 08:15', '08:15, 24:00', '08:15,', '08:15;20:30']) {
    await input.fill(raw);
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(first).toBeDisabled();
  }
  await input.fill('08:15, 20:30');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await first.check();
  await expect(form.getByTestId('plan-review-actions')).toContainText('Вибрано рядків: 1');
  await input.fill('08:20, 20:40');
  await expect(first).not.toBeChecked();
  await expect(form.getByRole('button', { name: 'Внести в план (0)' })).toBeDisabled();
  await first.check();
  for (const width of [320, 1024]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    await input.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(input).toHaveValue('08:20, 20:40');
    await expect(first).toBeChecked();
    await page.screenshot({ path: `test-results/import-times-${width}-${colorScheme}.png`, fullPage: true });
  }
  await form.getByRole('button', { name: 'Внести в план (1)' }).click();
  await expect(page).toHaveURL(/#\/plan$/);
  await page.goto('./#/plan/prescriptions');
  await expect(page.getByText('Без часу', { exact: true })).toBeVisible();
  await expect(page.getByText(/08:20, 20:40/)).toBeVisible();
  await expect(page.getByText('Нерозбірливий час', { exact: true })).toHaveCount(0);
  await expect(page.getByText('За потреби', { exact: true })).toHaveCount(0);
});
