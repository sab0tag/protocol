import { expect, test, type Page } from '@playwright/test';
import { device, seed, toast } from './helpers';

const date = '2026-11-04';
const original = { id: 'reschedule-meal', kind: 'meal', status: 'planned', at: `${date}T08:30:00+02:00`, title: 'Тестовий обід',
  items: [{ foodId: 'kefir', name: 'Кефір 2,5 %', grams: 200 }], menu: { tips: ['Синтетична порада'] }, via: 'photo' };

async function entries(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('protocol'); await new Promise(resolve => { open.onsuccess = resolve; });
    const get = open.result.transaction('entries', 'readonly').objectStore('entries').getAll();
    await new Promise(resolve => { get.onsuccess = resolve; }); open.result.close(); return get.result;
  });
}

async function setup(page: Page) {
  await page.clock.setFixedTime(new Date(`${date}T12:00:00+02:00`));
  await seed(page, [
    { store: 'plan', value: { id: 'main', onboardedAt: date, prescriptions: [], constraints: [], targets: {}, modes: [] } },
    { store: 'entries', value: original },
  ]);
  await page.goto('./#/');
}

test('an overdue meal moves to a future day in place; cancel, undo, offline reload and later editing retain the record', async ({ browser }) => {
  const page = await device(browser, 'skip'); await setup(page);
  const now = page.getByRole('region', { name: 'Зараз', exact: true });
  const open = async () => {
    await now.getByRole('button', { name: 'Перенести', exact: true }).click();
    return page.getByRole('dialog', { name: 'Перенести: Тестовий обід', exact: true });
  };
  let dialog = await open();
  await dialog.getByLabel('Нова дата', { exact: true }).fill('2026-11-05');
  await dialog.getByRole('button', { name: 'Скасувати', exact: true }).click();
  expect(await entries(page)).toEqual([original]);

  const move = async () => {
    dialog = await open();
    await dialog.getByLabel('Нова дата', { exact: true }).fill('2026-11-05');
    await dialog.getByLabel('Новий час', { exact: true }).fill('14:30');
    await dialog.getByRole('button', { name: 'Перенести', exact: true }).click();
    await expect(toast(page)).toContainText('Прийом їжі перенесено на 05.11 14:30');
  };
  await move();
  await toast(page).getByRole('button', { name: 'Скасувати', exact: true }).click();
  await expect(now).toContainText(original.title);
  expect(await entries(page)).toEqual([original]);

  await page.context().setOffline(true);
  await move();
  await page.reload();
  const rows = await entries(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ ...original, at: '2026-11-05T14:30:00+02:00', scheduleChanges: [
    { from: original.at, to: '2026-11-05T14:30:00+02:00', changedAt: '2026-11-04T10:00:00.000Z' },
  ] });
  await page.context().setOffline(false);
  await page.goto('./#/?date=2026-11-05');
  await page.getByRole('button', { name: /^Тестовий обід, Заплановано/ }).click();
  const confirmation = page.getByRole('dialog', { name: 'Підтвердити: Тестовий обід', exact: true });
  await confirmation.getByText('Історія переносів', { exact: true }).click();
  await expect(confirmation).toContainText('04.11.2026 08:30 → 05.11.2026 14:30');
  await confirmation.getByRole('button', { name: 'Редагувати', exact: true }).click();
  await page.getByRole('button', { name: 'Прийом: назва, час, з’їдено чи заплановано', exact: true }).click();
  await page.getByRole('textbox', { name: 'Назва прийому', exact: true }).fill('Відредагований обід');
  await page.getByRole('button', { name: 'Зберегти зміни', exact: true }).click();
  const edited = await entries(page);
  expect(edited).toHaveLength(1);
  expect(edited[0]).toMatchObject({ id: original.id, title: 'Відредагований обід', at: rows[0].at,
    scheduleChanges: rows[0].scheduleChanges, menu: original.menu });
  await page.context().close();
});

test('the move dialog rejects an elapsed time without changing the meal and fits a 320px screen', async ({ browser }) => {
  const page = await device(browser, 'skip'); await setup(page); await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole('region', { name: 'Зараз', exact: true }).getByRole('button', { name: 'Перенести', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Перенести: Тестовий обід', exact: true });
  await dialog.getByLabel('Нова дата', { exact: true }).fill(date);
  await dialog.getByLabel('Новий час', { exact: true }).fill('11:00');
  await dialog.getByRole('button', { name: 'Перенести', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Оберіть час у майбутньому.');
  expect(await entries(page)).toEqual([original]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.context().close();
});

test('a planned meal without products has the same move action; recorded meals cannot be moved', async ({ browser }) => {
  const page = await device(browser, 'skip'); await setup(page);
  await seed(page, [{ store: 'entries', value: { ...original, items: [] } }]);
  await page.getByRole('button', { name: /^Тестовий обід, Не відмічено/ }).click();
  await page.getByRole('dialog', { name: 'Тестовий обід', exact: true }).getByRole('button', { name: 'Перенести', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Перенести: Тестовий обід', exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Перенести: Тестовий обід', exact: true }).getByRole('button', { name: 'Скасувати', exact: true }).click();
  for (const status of ['done', 'skipped']) {
    await seed(page, [{ store: 'entries', value: { ...original, status } }]);
    await page.getByRole('button', { name: new RegExp(`^Тестовий обід, ${status === 'done' ? 'Виконано' : 'Пропущено'}`) }).click();
    await expect(page.getByRole('dialog', { name: 'Тестовий обід', exact: true }).getByRole('button', { name: 'Перенести', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Закрити', exact: true }).click();
  }
  await page.context().close();
});
