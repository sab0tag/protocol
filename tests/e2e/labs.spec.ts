import { expect, test } from '@playwright/test';
import { device, syncOn, toast } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

test('a lab form photo (model stubbed) → numbers checked against the paper → only the ticked go to «Аналізи» (D68)', async ({ browser }) => {
  const page = await device(browser);
  await syncOn(page);
  await page.route('**/labs', (r) => r.fulfill({ json: { readable: true, date: '2026-10-10', note: null, items: [
    { name: 'Феритин', value: 310, unit: 'нг/мл', reference: '30–400' }, { name: 'Глюкоза натще', value: 5.4, unit: 'ммоль/л', reference: '3,9–5,5' }] } }));
  await page.goto('./#/progress');
  await page.getByRole('button', { name: 'Фото бланка аналізів' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Дозволити й вибрати фото' }).click()]);
  await chooser.setFiles({ name: 'labs.png', mimeType: 'image/png', buffer: PNG });
  const form = page.getByRole('region', { name: 'Звірте кожне число з бланком' });
  await expect(form.getByText('На бланку референс: 30–400')).toBeVisible();
  await form.getByRole('checkbox', { name: 'Записати: Глюкоза натще' }).uncheck();
  await form.getByRole('textbox', { name: 'Значення: Феритин' }).fill('301');
  await form.getByRole('button', { name: 'Записати вибране (1)' }).click();
  await expect(toast(page)).toContainText('Записано показників: 1');
  await expect(page.getByRole('cell', { name: /^Феритин/ })).toBeVisible();
  await expect(page.getByText('301')).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Глюкоза натще/ })).toHaveCount(0);
});
