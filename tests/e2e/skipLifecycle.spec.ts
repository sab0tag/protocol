import { expect, test, type Page } from '@playwright/test';
import { device, seed, toast } from './helpers';

const date = '2026-10-28';

async function stored(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('protocol');
    await new Promise(resolve => { open.onsuccess = resolve; });
    const get = open.result.transaction('entries', 'readonly').objectStore('entries').get('outcome');
    await new Promise(resolve => { get.onsuccess = resolve; });
    open.result.close();
    return get.result;
  });
}

async function setup(page: Page, kind: 'med' | 'meal', status = 'done', skipReason?: string) {
  await page.clock.setFixedTime(new Date(`${date}T12:00:00+02:00`));
  await seed(page, [
    { store: 'plan', value: { id: 'main', onboardedAt: date, lastVisit: date, constraints: [], targets: {}, modes: [],
      prescriptions: kind === 'med' ? [{ id: 'med', title: 'Тестовий запис', kind: 'medication', source: 'Тест',
        schedule: { times: ['08:30'] } }] : [] } },
    { store: 'entries', value: { id: 'outcome', title: 'Тестовий запис', kind, status, at: `${date}T08:30:00+02:00`,
      ...(kind === 'med' ? { prescriptionId: 'med', checkKey: 'med:med:08:30' } : { items: [] }),
      ...(skipReason ? { skipReason } : {}) } },
  ]);
  await page.goto('./#/');
  await page.getByText(/^Виконано та інші відмітки/).click();
}

for (const kind of ['med', 'meal'] as const) {
  test(`${kind}: row-menu skip needs confirmation; undo and returning to plan clear the active skip reason`, async ({ browser }) => {
    const page = await device(browser, 'skip');
    await setup(page, kind);
    const row = () => page.getByRole('button', { name: /^Тестовий запис, / });
    const openSkip = async () => {
      await row().click();
      await page.getByRole('dialog', { name: 'Тестовий запис', exact: true }).getByRole('button', { name: 'Пропущено', exact: true }).click();
      return page.getByRole('dialog', { name: 'Пропустити: Тестовий запис' });
    };

    let dialog = await openSkip();
    await dialog.getByPlaceholder('Що завадило?').fill('Не збережена причина');
    await dialog.getByRole('button', { name: 'Скасувати', exact: true }).click();
    expect(await stored(page)).toMatchObject({ status: 'done' });
    expect((await stored(page)).skipReason).toBeUndefined();

    dialog = await openSkip();
    await dialog.getByPlaceholder('Що завадило?').fill('Перша причина');
    await dialog.getByRole('button', { name: 'Підтвердити пропуск' }).click();
    await expect(row()).toHaveAccessibleName(/Пропущено/);
    expect(await stored(page)).toMatchObject({ status: 'skipped', skipReason: 'Перша причина' });
    await toast(page).getByRole('button', { name: 'Скасувати', exact: true }).click();
    await expect(row()).toHaveAccessibleName(/Виконано/);
    expect((await stored(page)).skipReason).toBeUndefined();

    dialog = await openSkip();
    await dialog.getByPlaceholder('Що завадило?').fill('Підтверджена причина');
    await dialog.getByRole('button', { name: 'Підтвердити пропуск' }).click();
    await page.goto('./#/report');
    await expect(page.getByRole('region', { name: 'Підтверджені пропуски', exact: true })).toContainText('Підтверджена причина');
    await page.goto('./#/');
    await page.getByText(/^Виконано та інші відмітки/).click();
    await row().click();
    await page.getByRole('dialog', { name: 'Тестовий запис', exact: true }).getByRole('button', { name: 'Повернути в план', exact: true }).click();
    await expect.poll(async () => (await stored(page)).status).toBe('planned');
    expect((await stored(page)).skipReason).toBeUndefined();
    await page.goto('./#/report');
    await expect(page.getByRole('region', { name: 'Підтверджені пропуски', exact: true })).toHaveCount(0);

    await page.goto('./#/');
    // A new skip without a reason must not inherit the previous reason.
    if (kind === 'med') {
      await page.getByRole('region', { name: 'Зараз', exact: true }).getByRole('button', { name: 'Пропустити', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Пропустити: Тестовий запис' });
    } else dialog = await openSkip();
    await expect(dialog.getByPlaceholder('Що завадило?')).toHaveValue('');
    await dialog.getByRole('button', { name: 'Підтвердити пропуск' }).click();
    await expect.poll(async () => (await stored(page)).status).toBe('skipped');
    expect((await stored(page)).skipReason).toBeUndefined();
    expect(await page.evaluate(async () => {
      const open = indexedDB.open('protocol'); await new Promise(resolve => { open.onsuccess = resolve; });
      const get = open.result.transaction('entries', 'readonly').objectStore('entries').count();
      await new Promise(resolve => { get.onsuccess = resolve; }); open.result.close(); return get.result;
    })).toBe(1);
    await page.context().close();
  });
}

test('editing a skipped medicine as completed removes its previous skip reason', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await setup(page, 'med', 'skipped', 'Стара причина');
  await page.getByRole('button', { name: /^Тестовий запис, Пропущено/ }).click();
  await page.getByRole('dialog', { name: 'Тестовий запис', exact: true }).getByRole('button', { name: 'Редагувати', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Виконано', exact: true }).check();
  await page.getByRole('dialog', { name: 'Ліки або добавка', exact: true }).getByRole('button', { name: 'Записати', exact: true }).click();
  await expect.poll(async () => (await stored(page)).status).toBe('done');
  expect((await stored(page)).skipReason).toBeUndefined();
  await page.goto('./#/report');
  await expect(page.getByRole('region', { name: 'Підтверджені пропуски', exact: true })).toHaveCount(0);
  await page.context().close();
});
