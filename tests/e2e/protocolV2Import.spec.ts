import { expect, test } from '@playwright/test';
import { device, toast } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

test('photo review keeps confirmation reachable on small screens and retains checked lines after a failed write', async ({ browser }) => {
  const page = await device(browser, 'skip', { sw: false });
  await page.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      const scope = window as unknown as { failNextPlanSave: boolean };
      if (scope.failNextPlanSave && args[1] === 'readwrite' && Array.from(tx.objectStoreNames).includes('pieces') && Array.from(tx.objectStoreNames).includes('plan')) {
        scope.failNextPlanSave = false;
        queueMicrotask(() => tx.abort());
      }
      return tx;
    };
  });
  await page.reload(); // Install the storage fault boundary before Dexie caches native methods.
  await page.route('**/conclusion', (r) => r.fulfill({ json: {
    readable: true, date: '2026-10-26', doctor: 'Лікар', note: null, diagnosis: null, diet: null,
    constraints: [], tests: [], nextVisit: null, targets: [], unread: [{ text: 'Нерозбірливий рядок', page: 1, box: [0.1, 0.5, 0.6, 0.1] }],
    prescriptions: [
      { kind: 'medication', title: 'Перевірений препарат', dose: '10 мг', times: ['09:00'], perDay: 1, frequency: null, durationDays: null, asNeeded: false, withFood: null, page: 1, box: [0.1, 0.3, 0.6, 0.1], sure: 'yes' },
      { kind: 'medication', title: 'Без дози', dose: null, times: ['10:00'], perDay: 1, frequency: null, durationDays: null, asNeeded: false, withFood: null, page: 1, box: [0.1, 0.4, 0.6, 0.1], sure: 'check' },
    ],
  } }));
  await page.goto('./#/plan/scan');
  const steps = page.getByRole('list', { name: 'Етапи перенесення призначень' });
  await expect(steps.locator('[aria-current=step]')).toHaveText(/Фото/);
  await page.getByRole('button', { name: 'Фото висновку лікаря' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Дозволити й вибрати фото' }).click()]);
  await chooser.setFiles({ name: 'page.png', mimeType: 'image/png', buffer: PNG });
  await expect(steps.locator('[aria-current=step]')).toHaveText(/Приховати особисте/);
  await page.getByRole('button', { name: 'Надіслати', exact: true }).click();
  const form = page.getByRole('region', { name: /^Ось що я прочитав/ });
  await expect(form.getByText('Чернетка з фото')).toBeVisible();
  await expect(steps.locator('[aria-current=step]')).toHaveText(/Перевірити/);
  const checked = form.getByRole('checkbox', { name: 'Перевірений препарат 10 мг' });
  await expect(checked).not.toBeChecked();
  await expect(form.getByRole('checkbox', { name: 'Без дози', exact: true })).toBeDisabled();
  await expect(form.getByText('Потребують перевірки або ручного внесення: 2')).toBeVisible();
  await checked.check();
  const actions = form.getByTestId('plan-review-actions');
  await expect(actions).toContainText('Вибрано рядків: 1');
  for (const [width, height, colorScheme] of [[320, 568, 'light'], [390, 844, 'dark'], [1024, 768, 'light']] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme });
    await form.getByRole('heading', { level: 2 }).scrollIntoViewIfNeeded();
    const box = await actions.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThan(height - (width < 768 ? 60 : 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/protocol-v2-import-${width}-${colorScheme}.png`, fullPage: true });
  }
  // Abort one actual IndexedDB plan/pieces transaction; retry uses the same reviewed draft.
  await page.evaluate(() => { (window as unknown as { failNextPlanSave: boolean }).failNextPlanSave = true; });
  await actions.getByRole('button', { name: 'Внести в план (1)' }).click();
  await expect(toast(page)).toContainText('Не вдалося');
  await expect(page).toHaveURL(/#\/plan\/scan$/);
  await expect(checked).toBeChecked();
  await actions.getByRole('button', { name: 'Внести в план (1)' }).click();
  await expect(page).toHaveURL(/#\/plan$/);
  await page.goto('./#/plan/prescriptions');
  await expect(page.getByText('Перевірений препарат', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Без дози', { exact: true })).toHaveCount(0);
});
