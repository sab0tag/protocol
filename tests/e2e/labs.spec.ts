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

test('a doctor’s conclusion photo (model stubbed) → lines unticked, checked against the paper → only the ticked go into «План» (D80)', async ({ browser }) => {
  const page = await device(browser, 'skip'); // an empty plan
  await syncOn(page);
  await page.route('**/conclusion', (r) => r.fulfill({ json: { readable: true, date: '2026-10-12', doctor: 'Ендокринолог', note: 'Підпис не прочитано',
    tests: ['HbA1c'], nextVisit: '2026-12-10',
    constraints: [{ tag: 'glycemic', title: 'Предіабет', reason: 'Повільні вуглеводи, без солодкого', allergens: [] }],
    prescriptions: [{ kind: 'medication', title: 'Метформін', dose: '500 мг', times: [], frequency: '2 рази на день', withFood: true }],
    targets: { kcal: null, proteinG: null, carbsMaxG: null, fatG: null, waterMl: 2000, lastMealBy: '19:00', weightGoalKg: null, maxWeightLossKgPerWeek: null } } }));
  await page.goto('./#/plan');
  await page.getByRole('button', { name: 'Фото висновку лікаря' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Дозволити й вибрати фото' }).click()]);
  await chooser.setFiles({ name: 'c.png', mimeType: 'image/png', buffer: PNG });
  const form = page.getByRole('region', { name: /^Звірте кожен рядок/ });
  await expect(form).toContainText('Джерело: Ендокринолог, 12.10.2026');
  await expect(form).toContainText('Підпис не прочитано');
  await expect(form).toContainText('2 рази на день · час прийому оберіть у «Плані»'); // no invented time
  await expect(form.getByRole('button', { name: 'Внести в план (0)' })).toBeDisabled(); // nothing ticked for the person
  await form.getByRole('checkbox', { name: /Метформін/ }).check();
  await form.getByRole('checkbox', { name: /Предіабет/ }).check();
  await form.getByRole('checkbox', { name: /Вода, мл/ }).check();
  await form.getByRole('button', { name: 'Внести в план (3)' }).click();
  await expect(toast(page)).toContainText('Внесено в план: 3');
  await expect(page.getByText('Метформін')).toBeVisible();
  await expect(page.getByText(/Вкажіть час прийому: лікар написав 2 рази на день/)).toBeVisible(); // the app never picks the times
  await expect(page.getByText('Предіабет')).toBeVisible();
  await expect(page.getByText(/вода 2000 мл/)).toBeVisible();
  await expect(page.getByText(/їжа до 19:00/)).toHaveCount(0); // not ticked — not in the plan
});
