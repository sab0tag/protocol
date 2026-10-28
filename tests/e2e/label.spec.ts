import { expect, test } from '@playwright/test';
import { device, syncOn, toast } from './helpers';

// a 2×2 PNG — the app redraws any photo as JPEG before sending
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

test('a package photo (model stubbed) → checked numbers → own food, added to the meal', async ({ browser }) => {
  const page = await device(browser);
  await syncOn(page);
  let sent = '';
  await page.route('**/label', async (r) => {
    sent = (r.request().postDataJSON() as { image: string }).image;
    await r.fulfill({ json: { readable: true, name: 'Йогурт грецький Галичина 2 %', servingG: 140, note: null,
      per100g: { kcal: 73, protein: 9.5, fat: 2, carbs: 3.9, calciumMg: null } } });
  });
  await page.goto('./#/meal/new');
  await page.getByText('Голос та скан етикетки', { exact: true }).click();
  await page.getByRole('button', { name: 'Скан етикетки' }).click();
  await page.getByRole('button', { name: /Фото етикетки/ }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Дозволити й вибрати фото' }).click()]);
  await chooser.setFiles({ name: 'label.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Перевірте цифри з упаковки')).toBeVisible();
  expect(Buffer.from(sent, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8'); // JPEG, metadata gone
  await expect(page.getByLabel('ккал')).toHaveValue('73');
  await expect(page.getByLabel('З’їдено, г')).toHaveValue('140');
  await page.getByRole('button', { name: 'молоко', exact: true }).click(); // D57: ticked by the person, from the package
  await page.getByRole('button', { name: 'Зберегти й додати' }).click();
  await expect(toast(page)).toContainText('у вашій базі');
  await expect(page.locator('li').filter({ hasText: 'Йогурт грецький Галичина' }).first()).toBeVisible();
  await page.goto('./#/foods');
  await expect(page.getByRole('textbox', { name: 'Назва' }).first()).toHaveValue('Йогурт грецький Галичина 2 %');
  await expect(page.getByRole('button', { name: 'молоко', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');
});
