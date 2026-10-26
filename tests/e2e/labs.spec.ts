import { expect, test } from '@playwright/test';
import { device, syncOn, toast } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

test('a lab form photo (model stubbed) → numbers checked against the paper → only the ticked go to «Аналізи» (D68)', async ({ browser }) => {
  const page = await device(browser);
  await syncOn(page);
  await page.route('**/labs', (r) => r.fulfill({ json: { readable: true, date: '2026-10-10', note: null, items: [
    { name: 'Феритин', value: 310, unit: 'нг/мл', reference: '30–400' }, { name: 'Глюкоза натще', value: 5.4, unit: 'ммоль/л', reference: '3,9–5,5' }] } }));
  await page.goto('./#/progress/labs');
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
  await page.getByRole('link', { name: /Фото висновку лікаря/ }).click();
  await expect(page).toHaveURL(/#\/plan\/scan$/);
  await page.getByRole('button', { name: 'Фото висновку лікаря' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Дозволити й вибрати фото' }).click()]);
  await chooser.setFiles([{ name: 'p1.png', mimeType: 'image/png', buffer: PNG }, { name: 'p2.png', mimeType: 'image/png', buffer: PNG }]);
  await page.getByRole('region', { name: 'Приховайте особисте перед надсиланням' }).getByRole('button', { name: 'Надіслати 2 сторінки' }).click(); // D112
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
  await form.getByRole('button', { name: 'Відмітити все з ✓, крім ліків' }).click();
  await expect(form.getByRole('checkbox', { name: 'Метформін 500 мг', exact: true })).not.toBeChecked(); // medicines are confirmed one by one (D101), named for a screen reader (D103)
  await expect(form.getByRole('checkbox', { name: /Останній прийом їжі/ })).not.toBeChecked(); // a «?» line is checked by hand (D103)
  await expect(form.getByRole('checkbox', { name: 'HbA1c' })).toBeChecked(); // the test is a line of its own, not under the visit’s date
  await form.getByRole('checkbox', { name: 'Метформін 500 мг', exact: true }).check();
  await form.getByRole('button', { name: 'Внести в план (5)' }).click();
  await expect(toast(page)).toContainText('Внесено в план: 5');
  await page.goto('./#/plan/prescriptions');
  await expect(page.getByText('Метформін')).toBeVisible();
  await expect(page.getByText(/Вкажіть час прийому/)).toHaveCount(0); // the times are in, marked suggested when they were
  await page.goto('./#/plan/constraints');
  await expect(page.getByText('Порушена глікемія')).toBeVisible();
  await page.goto('./#/plan/goals');
  await expect(page.getByText(/вода 2000 мл/)).toBeVisible();
  await expect(page.getByText(/їжа до 19:00/)).toHaveCount(0); // not ticked — not in the plan
  await expect(page.getByText('Каптоприл')).toHaveCount(0);
  // D114: the line as it was on the paper — kept on this device, opened from «План»
  await page.goto('./#/plan/prescriptions');
  const metformin = page.getByRole('listitem').filter({ hasText: 'Метформін' }).first();
  await metformin.getByRole('button', { name: 'Показати на папері' }).click();
  await expect(metformin.getByRole('img', { name: '«Метформін» у висновку лікаря' })).toBeVisible();
});

test('before the paper leaves the phone: the header comes painted over, a finger paints more, the top is cut — only that is sent (D112)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  // a white page 400 × 600, as a photo
  const jpeg = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 600;
    const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 600); return c.toDataURL('image/jpeg', 0.95).split(',')[1]!; }), 'base64');
  let sent = '';
  await page.route('**/conclusion', async (r) => { sent = (r.request().postDataJSON() as { images: string[] }).images[0]!;
    await r.fulfill({ json: { readable: false, date: null, doctor: null, diet: null, constraints: [], prescriptions: [], tests: [], nextVisit: null, targets: [], unread: [], note: 'Порожньо' } }); });
  await page.goto('./#/plan/scan');
  await page.getByRole('button', { name: 'Фото висновку лікаря' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Дозволити й вибрати фото' }).click()]);
  await chooser.setFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  const prep = page.getByRole('region', { name: 'Приховайте особисте перед надсиланням' });
  await expect(prep.getByText('Тут зазвичай ПІБ і дата народження')).toBeVisible(); // suggested, already painted
  const area = prep.locator('[data-page="1"]');
  const b = (await area.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.6); await page.mouse.down(); // a box over 50–80 % × 60–70 %
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.7, { steps: 4 }); await page.mouse.up();
  await expect(prep.locator('[data-box]')).toHaveCount(2);
  await prep.getByLabel('Обрізати згори').fill('0.1');
  await prep.getByRole('button', { name: 'Надіслати', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Порожньо');
  const px = await page.evaluate(async (data) => { // what left the phone: its size and the colour at a few points
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d')!; x.drawImage(bmp, 0, 0);
    const at = (fx: number, fy: number) => x.getImageData(Math.round(fx * bmp.width), Math.round(fy * bmp.height), 1, 1).data[0]!;
    // original 600 high, 60 cut off the top → 540; the header (0–120) is now 0–60, the box (360–420) is now 300–360
    return { w: bmp.width, h: bmp.height, header: at(0.5, 30 / 540), box: at(0.65, 330 / 540), clear: at(0.2, 300 / 540), bottom: at(0.5, 500 / 540) };
  }, sent);
  expect([px.w, px.h]).toEqual([400, 540]);
  expect(px.header).toBeLessThan(30); // black
  expect(px.box).toBeLessThan(30);
  expect(px.clear).toBeGreaterThan(220); // white, untouched
  expect(px.bottom).toBeGreaterThan(220);
});

test('onboarding starts from the doctor’s paper: photo → hide what is personal → each medicine confirmed or put aside → «Почати» → «День» with its doses (D113)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // the morning: a medicine comes in «from now» (D103) — run in the evening, today's 08:00 and 20:00 would both be behind it
  const now = new Date();
  await page.clock.setFixedTime(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 0)));
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const w = (sure: string) => ({ page: 1, box: [0.1, 0.4, 0.7, 0.03], sure });
  await page.route('**/conclusion', (r) => r.fulfill({ json: { readable: true, date: '2026-10-16', doctor: 'Ендокринолог', note: null, diagnosis: null, diet: null,
    constraints: [], tests: [], nextVisit: null, targets: [], unread: [],
    prescriptions: [
      { kind: 'medication', title: 'Метформін', dose: '500 мг', times: [], perDay: 2, frequency: '2 рази на день', durationDays: null, asNeeded: false, withFood: true, ...w('yes') },
      { kind: 'medication', title: 'Каптоприл', dose: null, times: [], perDay: 1, frequency: null, durationDays: null, asNeeded: false, withFood: null, ...w('check') }] } }));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сфотографуйте призначення лікаря');
  await expect(page.getByRole('button', { name: 'Ввести вручну' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подивитись на прикладі' })).toBeVisible();
  await page.getByRole('button', { name: 'Фото висновку лікаря' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Дозволити й вибрати фото' }).click()]);
  await chooser.setFiles({ name: 'p.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('region', { name: 'Приховайте особисте перед надсиланням' }).getByRole('button', { name: 'Надіслати', exact: true }).click();
  const form = page.getByRole('region', { name: /^Ось що я прочитав/ });
  await form.getByRole('checkbox', { name: 'Метформін 500 мг' }).check();
  await expect(form.getByRole('status')).toContainText('Ліки без рішення: 1'); // the Каптоприл without its dose
  await expect(form.getByRole('button', { name: 'Почати (1)' })).toBeDisabled();
  await form.getByRole('button', { name: 'Не вносити' }).click();
  await form.getByRole('button', { name: 'Почати (1)' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByText('Метформін').first()).toBeVisible(); // «День» — its doses at the suggested times
  await page.goto('./#/plan/prescriptions');
  await expect(page.getByText('Каптоприл')).toHaveCount(0);
  await expect(page.getByText(/08:00, 20:00/)).toBeVisible();
});

test('a later visit: the new paper against the plan — new, and a medicine it does not name is closed only when asked (D115)', async ({ browser }) => {
  const page = await device(browser); // the example plan: Вітамін D 2000 МО at 08:30
  const w = { page: 1, box: [0.1, 0.4, 0.7, 0.03], sure: 'yes' };
  await page.route('**/conclusion', (r) => r.fulfill({ json: { readable: true, date: '2026-10-19', doctor: 'Ендокринолог', note: null, diagnosis: null, diet: null,
    constraints: [], tests: [], nextVisit: null, targets: [], unread: [], prescriptions: [
      { kind: 'medication', title: 'Еутирокс', dose: '50 мкг', times: ['07:00'], perDay: 1, frequency: null, durationDays: null, asNeeded: false, withFood: false, ...w }] } }));
  await page.goto('./#/plan/scan');
  await page.getByRole('button', { name: 'Фото висновку лікаря' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Дозволити й вибрати фото' }).click()]);
  await chooser.setFiles({ name: 'p.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('region', { name: 'Приховайте особисте перед надсиланням' }).getByRole('button', { name: 'Надіслати', exact: true }).click();
  const form = page.getByRole('region', { name: /^Ось що я прочитав/ });
  await expect(form.getByRole('checkbox', { name: 'Еутирокс 50 мкг' })).toBeVisible();
  await expect(form).toContainText('Еутирокс · 50 мкг · нове');
  await expect(form).toContainText('Немає в новому висновку');
  const close = form.getByRole('checkbox', { name: /^Закрити з сьогодні: Вітамін D/ });
  await expect(close).not.toBeChecked(); // never closed silently
  await close.check();
  await form.getByRole('checkbox', { name: 'Еутирокс 50 мкг' }).check();
  await form.getByRole('button', { name: 'Внести в план (2)' }).click();
  await expect(toast(page)).toContainText('Внесено в план: 2');
  await page.goto('./#/plan/prescriptions');
  await expect(page.getByText('Еутирокс')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Вітамін D' }).first()).toContainText('курс закінчився'); // closed, its history stays
});
