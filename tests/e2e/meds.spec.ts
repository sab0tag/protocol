import { expect, test } from '@playwright/test';
import { device, syncOn } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

async function addFromRegistry(page: import('@playwright/test').Page, typed: string, pick: RegExp) {
  await page.locator('section.rounded-2xl').filter({ has: page.getByRole('heading', { name: 'Призначення', exact: true }) }).getByRole('button', { name: 'Додати' }).click();
  const form = page.getByRole('dialog', { name: 'Призначення' });
  await form.getByRole('textbox', { name: 'Назва' }).fill(typed);
  await form.getByRole('button', { name: pick }).first().click();
  await expect(form.getByText(/^з реєстру · Ibuprofen/)).toBeVisible();
  await expect(form.getByRole('textbox', { name: /^Доза/ })).toHaveValue(''); // the register never fills a dose
  await form.getByRole('button', { name: 'Зберегти' }).click();
}

test('the medicines register: Latin typing finds it, no dose filled, one INN twice — a note, not a ban; offline, no sync (D89)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/plan');
  await addFromRegistry(page, 'nurofen', /^Нурофєн® · Ibuprofen/);
  await addFromRegistry(page, 'ібупрофен', /^Ібупрофен.* · Ibuprofen/);
  const note = page.getByRole('status').filter({ hasText: 'одна речовина (Ibuprofen)' });
  await expect(note).toContainText('Перевірте з лікарем');
  await expect(note).not.toContainText('не приймайте');
  await page.goto('./#/more');
  await page.getByRole('link', { name: 'Про застосунок і джерела' }).click();
  await expect(page.getByRole('link', { name: 'CC BY 4.0' })).toBeVisible();
  await expect(page.getByText(/індекс від .*, \d+ препаратів/)).toBeVisible();
});

test('a package photo (model stubbed): the name found in the register; the strength said, not put in the dose (D89)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await syncOn(page);
  await page.route('**/medbox', (r) => r.fulfill({ json: { readable: true, name: 'Еутирокс', inn: 'левотироксин', strength: '100 мкг', form: 'таблетки', note: null } }));
  await page.goto('./#/plan');
  await page.locator('section.rounded-2xl').filter({ has: page.getByRole('heading', { name: 'Призначення', exact: true }) }).getByRole('button', { name: 'Додати' }).click();
  const form = page.getByRole('dialog', { name: 'Призначення' });
  await form.getByRole('button', { name: 'Фото упаковки' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), form.getByRole('button', { name: 'Дозволити й вибрати фото' }).click()]);
  await chooser.setFiles({ name: 'box.png', mimeType: 'image/png', buffer: PNG });
  await expect(form.getByRole('textbox', { name: 'Назва' })).toHaveValue('Еутирокс');
  await expect(form.getByText(/^з реєстру · Levothyroxine sodium/)).toBeVisible();
  await expect(form.getByText(/На упаковці: Еутирокс, 100 мкг, таблетки/)).toBeVisible();
  await expect(form.getByRole('textbox', { name: /^Доза/ })).toHaveValue('');
});
