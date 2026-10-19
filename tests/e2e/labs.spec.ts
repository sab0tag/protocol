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

test('a doctor’s conclusion, two pages, no account (model stubbed) → «Ось що я прочитав» with ✓ ? ✗ → medicines ticked one by one, only with a dose → «План» (D80, D101)', async ({ browser }) => {
  const page = await device(browser, 'skip'); // an empty plan, no sync — the device token is taken from the real local server
  const w = (sure: string, page = 1) => ({ page, box: [0.1, 0.3, 0.6, 0.05], sure });
  let auth = '', pages = 0;
  await page.route('**/conclusion', async (r) => {
    auth = r.request().headers().authorization ?? ''; pages = (r.request().postDataJSON() as { images: string[] }).images.length;
    await r.fulfill({ json: { readable: true, date: '2026-10-12', doctor: 'Ендокринолог', note: 'Підпис не прочитано', diagnosis: 'Предіабет',
      diet: null, tests: [{ title: 'HbA1c', ...w('yes') }], nextVisit: { date: '2026-12-10', ...w('yes', 2) },
      constraints: [{ tag: 'glycemic', title: 'Порушена глікемія', reason: 'Повільні вуглеводи, без солодкого', allergens: [], ...w('yes') }],
      prescriptions: [
        { kind: 'medication', title: 'Метформін', dose: '500 мг', times: [], perDay: 2, frequency: '2 рази на день', durationDays: null, asNeeded: false, withFood: true, ...w('yes') },
        { kind: 'medication', title: 'Каптоприл', dose: null, times: [], perDay: 1, frequency: '1 раз на день', durationDays: null, asNeeded: false, withFood: null, ...w('check') }],
      targets: [{ key: 'waterMl', value: '2 л', ...w('yes') }, { key: 'lastMealBy', value: '19:00', ...w('check') }],
      unread: [{ text: 'Ам…ин 1/2 т', page: 2, box: [0.1, 0.6, 0.4, 0.05] }] } });
  });
  await page.goto('./#/plan');
  await page.getByRole('button', { name: 'Фото висновку лікаря' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Дозволити й вибрати фото' }).click()]);
  await chooser.setFiles([{ name: 'p1.png', mimeType: 'image/png', buffer: PNG }, { name: 'p2.png', mimeType: 'image/png', buffer: PNG }]);
  const form = page.getByRole('region', { name: /^Ось що я прочитав/ });
  await expect(form).toContainText('Джерело: Ендокринолог, 12.10.2026');
  expect(auth).toMatch(/^Device [A-Za-z0-9_-]{43}$/); // no sync, no account
  expect(pages).toBe(2);
  await expect(form).not.toContainText('Предіабет'); // the diagnosis is not kept
  await expect(form).toContainText('08:00, 20:00 (час запропоновано)'); // a suggested time is said to be one
  await expect(form).toContainText('? перевірте з папером');
  await expect(form).toContainText('✗ не прочитано');
  await expect(form.getByRole('img', { name: 'Фрагмент висновку, звідки взято рядок' }).first()).toBeVisible();
  await expect(form.getByRole('checkbox', { name: /Каптоприл/ })).toBeDisabled(); // no dose read — not into the plan
  await expect(form.getByRole('button', { name: 'Внести в план (0)' })).toBeDisabled(); // nothing ticked for the person
  await form.getByRole('button', { name: 'Відмітити все, крім ліків' }).click();
  await expect(form.getByRole('checkbox', { name: /Метформін/ })).not.toBeChecked(); // medicines are confirmed one by one
  await form.getByRole('checkbox', { name: /Метформін/ }).check();
  await form.getByRole('checkbox', { name: /Останній прийом їжі/ }).uncheck();
  await form.getByRole('button', { name: 'Внести в план (4)' }).click();
  await expect(toast(page)).toContainText('Внесено в план: 4');
  await expect(page.getByText('Метформін')).toBeVisible();
  await expect(page.getByText(/Вкажіть час прийому/)).toHaveCount(0); // the times are in, marked suggested when they were
  await expect(page.getByText('Порушена глікемія')).toBeVisible();
  await expect(page.getByText(/вода 2000 мл/)).toBeVisible();
  await expect(page.getByText(/їжа до 19:00/)).toHaveCount(0); // not ticked — not in the plan
  await expect(page.getByText('Каптоприл')).toHaveCount(0);
});
