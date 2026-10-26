import { expect, test, type Page } from '@playwright/test';
import { device, seed, ymd } from './helpers';
const enabled = process.env.VITE_MODULE_POLICY_ENABLED === 'true';
const names = ['Ліки', 'Вода', 'Запис їжі', 'Меню', 'Помічник', 'Самопочуття', 'Тренування', 'Прогрес і тиждень'];
const ids = ['meds', 'water', 'food', 'menu', 'assistant', 'wellbeing', 'workout', 'progress'];
async function minimal(page: Page, on = ['meds']) {
  await seed(page, [
    ...ids.map((module) => ({ store: 'moduleEvents', value: { id: `settings-${module}`, v: 1, kind: 'module', module, enabled: on.includes(module),
      source: 'onboarding', at: '2026-01-01T00:00:00.000Z' } })),
    { store: 'entries', value: { id: 'kept-meal', at: ymd(new Date()) + 'T12:00:00+02:00', kind: 'meal', status: 'done', title: 'Збережена страва', items: [{ name: 'Яблуко', grams: 100 }] } },
  ]);
}
async function rows(page: Page, table: string) {
  return page.evaluate(async (table) => {
    const open = indexedDB.open('protocol'); await new Promise((r) => { open.onsuccess = r; });
    const get = open.result.transaction(table, 'readonly').objectStore(table).getAll(); await new Promise((r) => { get.onsuccess = r; });
    open.result.close(); return get.result;
  }, table);
}

test('ordinary builds keep legacy UI and do not expose module switches', async ({ browser }) => {
  test.skip(enabled, 'compatibility build');
  const page = await device(browser); await minimal(page, []);
  await expect(page.getByRole('button', { name: 'Записати їжу', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Додати 250 мл води/ })).toBeVisible();
  await page.goto('./#/modules'); await expect(page.getByText('Налаштування модулів ще готуються до ввімкнення.')).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);
});

test('minimal day hides disabled actions and More stays short; food comes back with its saved records', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await device(browser); await minimal(page);
  await expect(page.getByRole('button', { name: 'Записати їжу', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Додати 250 мл води/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Сказати голосом', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Мені погано', exact: true })).toBeVisible();
  await expect(page.getByText('Збережена страва', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('minimal-day.png'), fullPage: true });
  const tabs = page.getByRole('navigation', { name: 'Розділи' });
  await expect(tabs.getByRole('link')).toHaveCount(3);
  await page.goto('./#/more');
  expect(await page.locator('main a:visible').count() + await page.locator('main details > summary:visible').count()).toBeLessThanOrEqual(8);
  await expect(page.getByRole('link', { name: 'Мої страви', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Що показувати', exact: true }).click();
  await expect(page.getByRole('switch')).toHaveCount(8);
  await page.screenshot({ path: test.info().outputPath('module-settings.png'), fullPage: true });
  await page.getByRole('switch', { name: 'Запис їжі', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Запис їжі', exact: true })).toBeChecked();
  await page.goto('./#/'); await expect(page.getByRole('button', { name: /Збережена страва, Виконано/ })).toBeVisible();
  expect((await rows(page, 'entries')).filter((e) => e.id === 'kept-meal')).toHaveLength(1);
  await page.reload(); await expect(page.getByRole('button', { name: 'Записати їжу', exact: true })).toBeVisible();
});

test('meds off asks first; cancelling writes nothing, and plan/report/incomplete-course warnings remain accessible', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await device(browser); await minimal(page);
  const plan = (await rows(page, 'plan'))[0];
  await seed(page, [{ store: 'plan', value: { ...plan, constraints: [], modes: [], prescriptions: [...plan.prescriptions.map((p: { id: string }) => ({ ...p, id: 'own-' + p.id, source: 'Лікар' })),
    { id: 'unfinished', kind: 'medication', title: 'Уточніть призначення', source: '' }] } }]);
  await page.goto('./#/modules');
  const before = (await rows(page, 'moduleEvents')).length;
  await page.getByRole('switch', { name: 'Ліки', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Нагадувань про ліки не буде. Вимкнути?' });
  await confirm.getByRole('button', { name: 'Залишити увімкненим', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Ліки', exact: true })).toBeChecked();
  expect((await rows(page, 'moduleEvents')).length).toBe(before);
  await page.getByRole('switch', { name: 'Ліки', exact: true }).click();
  await confirm.getByRole('button', { name: 'Вимкнути', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Ліки', exact: true })).not.toBeChecked();
  await page.goto('./#/'); await expect(page.getByText(/Уточніть призначення/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Вітамін D, Заплановано/ })).toHaveCount(0);
  await page.goto('./#/plan'); await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Розділ вимкнено');
  await page.goto('./#/report'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Звіт для лікаря');
});

test('direct URLs and old quick bookmarks cannot write or silently enable a disabled module', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await device(browser); await minimal(page, []);
  const before = await rows(page, 'entries'), events = await rows(page, 'moduleEvents');
  for (const path of ['/menu', '/shopping', '/dishes', '/assistant', '/concierge-log', '/wellbeing', '/workout', '/exercises', '/week', '/progress', '/meal/new', '/meal/kept-meal', '/do/water', '/do/med', '/weight']) {
    await page.goto('./#' + path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Розділ вимкнено');
    await expect(page.getByRole('link', { name: 'Що показувати', exact: true })).toBeVisible();
  }
  expect(await rows(page, 'entries')).toEqual(before); expect(await rows(page, 'moduleEvents')).toEqual(events);
});

test('voice still shows danger help with food/assistant off and cannot silently save disabled parts of a mixed draft', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await device(browser); await minimal(page, []);
  await page.goto('./#/do/voice');
  const dialog = page.getByRole('dialog', { name: 'Скажіть, що з’їли чи прийняли' });
  await dialog.getByRole('button', { name: 'Зрозуміло, говорити' }).click();
  const field = dialog.getByLabel('Або напишіть тут');
  await field.fill('не можу дихати'); await expect(dialog.getByRole('alert')).toContainText('103');
  await field.fill('склянка води, яблуко 100 г');
  await expect(dialog.getByText(/У чернетці є записи вимкнених модулів/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Записати', exact: true })).toBeDisabled();
  expect((await rows(page, 'entries')).filter((e) => e.via === 'voice')).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Прибрати: Вода', exact: true }).click();
  await expect(dialog.getByText(/Вода — /)).toHaveCount(0);
});

test('weight works independently and enable-all restores modules without replacing medication history', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await device(browser); await minimal(page);
  await page.goto('./#/modules'); await page.getByRole('checkbox', { name: 'Вага окремо', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Самопочуття', exact: true })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'Прогрес і тиждень', exact: true })).not.toBeChecked();
  await page.goto('./#/weight'); await page.getByLabel('Вага, кг', { exact: true }).fill('90.5');
  await page.getByRole('button', { name: 'Записати вагу', exact: true }).click();
  await expect.poll(async () => (await rows(page, 'weights')).length).toBe(1);
  const medEvents = (await rows(page, 'moduleEvents')).filter((e) => e.kind === 'module' && e.module === 'meds');
  await page.goto('./#/modules'); await page.getByRole('button', { name: 'Увімкнути все', exact: true }).click();
  for (const name of names) await expect(page.getByRole('switch', { name, exact: true })).toBeChecked();
  expect((await rows(page, 'moduleEvents')).filter((e) => e.kind === 'module' && e.module === 'meds')).toEqual(medEvents);
});

test('a module turned off in another open tab unmounts its form before it can save', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await device(browser); await minimal(page, ['meds', 'food']);
  await page.goto('./#/meal/kept-meal'); await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Розділ вимкнено');
  const settings = await page.context().newPage(); await settings.goto('http://localhost:4318/#/modules');
  await settings.getByRole('switch', { name: 'Запис їжі', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Розділ вимкнено');
  expect((await rows(page, 'entries')).find((e) => e.id === 'kept-meal').title).toBe('Збережена страва');
});

test('demo shows all modules with read-only switches', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await device(browser, 'demo'); await page.goto('./#/modules');
  for (const name of names) { const toggle = page.getByRole('switch', { name, exact: true }); await expect(toggle).toBeChecked(); await expect(toggle).toBeDisabled(); }
  await page.goto('./#/more'); await expect(page.getByRole('link', { name: 'Мої страви', exact: true })).toBeVisible();
});
