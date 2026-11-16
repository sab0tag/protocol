import { expect, test } from '@playwright/test';
import { device, seed, toast, ymd } from './helpers';

test('uncertainty is separate from unknown time, can be corrected, and a late completion keeps its actual time', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const now = new Date();
  now.setHours(9, 0, 0, 0);
  const date = ymd(now);
  await page.clock.setFixedTime(now);
  await seed(page, [{
    store: 'plan',
    value: {
      id: 'main', onboardedAt: date, constraints: [], targets: {}, modes: [],
      prescriptions: [{ id: 'vitamin-d', kind: 'medication', title: 'Вітамін D', source: 'Тест', since: date,
        schedule: { times: ['08:30'] } }],
    },
  }]);

  const due = page.getByRole('region', { name: 'Зараз' });
  await due.getByRole('button', { name: 'Не впевнені, чи прийняли' }).click();
  await expect(toast(page)).toContainText('Вітамін D — не впевнені, чи прийнято');

  const uncertain = await page.evaluate(async () => {
    const request = indexedDB.open('protocol');
    await new Promise<void>((resolve, reject) => { request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    const get = request.result.transaction('entries', 'readonly').objectStore('entries').getAll();
    const rows = await new Promise<{ status: string; adherence?: string; timeUnknown?: boolean }[]>((resolve) => { get.onsuccess = () => resolve(get.result); });
    request.result.close();
    return rows.filter((entry) => entry.adherence === 'uncertain');
  });
  expect(uncertain).toHaveLength(1);
  expect(uncertain[0]).toMatchObject({ status: 'planned', adherence: 'uncertain' });
  expect(uncertain[0]?.timeUnknown).toBeUndefined();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const dock = page.getByRole('group', { name: 'Ліки й вода' });
  await dock.getByRole('button', { name: 'Уточнити, чи прийняли: Вітамін D' }).click();
  await page.getByRole('dialog', { name: 'Вітамін D — коли прийняли?' })
    .getByRole('button', { name: /^Щойно/ }).click();

  const corrected = await page.evaluate(async () => {
    const request = indexedDB.open('protocol');
    await new Promise<void>((resolve, reject) => { request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    const get = request.result.transaction('entries', 'readonly').objectStore('entries').getAll();
    const rows = await new Promise<{ at: string; status: string; adherence?: string }[]>((resolve) => { get.onsuccess = () => resolve(get.result); });
    request.result.close();
    return rows.filter((entry) => entry.kind === 'med');
  });
  expect(corrected).toHaveLength(1);
  expect(corrected[0]).toMatchObject({ status: 'done', adherence: 'completed_late', at: expect.stringContaining('T09:00:00') });
  await page.reload();
  await page.getByText(/^Виконано та інші відмітки/).click();
  await expect(page.getByRole('button', { name: 'Вітамін D, Виконано пізніше за планом' })).toBeVisible();
  await page.goto('./#/report');
  await expect(page.getByRole('region', { name: 'Головне' })).toContainText('Пізно виконано: 1 доз.');
});

test('My Day asks for an actual time on past doses and prevents marking a future dose', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const now = new Date();
  now.setHours(9, 0, 0, 0);
  const date = ymd(now);
  await page.clock.setFixedTime(now);
  await seed(page, [{
    store: 'plan',
    value: {
      id: 'main', onboardedAt: date, constraints: [], targets: {}, modes: [],
      prescriptions: [{ id: 'vitamin-d', kind: 'medication', title: 'Вітамін D', source: 'Тест',
        schedule: { times: ['08:30'] } }],
    },
  }]);

  await page.goto('./#/my-day');
  await page.getByRole('button', { name: 'Попередній день' }).click();
  await page.getByRole('button', { name: /Вітамін D/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Вітамін D — коли прийняли?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Час не пам’ятаю' }).click();
  await expect(toast(page)).toContainText('Вітамін D');

  const historical = await page.evaluate(async () => {
    const request = indexedDB.open('protocol');
    await new Promise<void>((resolve, reject) => { request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    const get = request.result.transaction('entries', 'readonly').objectStore('entries').getAll();
    const rows = await new Promise<{ status: string; timeUnknown?: boolean; adherence?: string }[]>((resolve) => { get.onsuccess = () => resolve(get.result); });
    request.result.close();
    return rows.filter((entry) => entry.timeUnknown);
  });
  expect(historical).toHaveLength(1);
  expect(historical[0]).toMatchObject({ status: 'done', timeUnknown: true });
  expect(historical[0]?.adherence).toBeUndefined();

  await page.getByRole('button', { name: 'Наступний день' }).click();
  await page.getByRole('button', { name: 'Наступний день' }).click();
  await expect(page.getByRole('button', { name: /Вітамін D/ })).toBeDisabled();
  const count = await page.evaluate(async () => {
    const request = indexedDB.open('protocol');
    await new Promise<void>((resolve, reject) => { request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    const get = request.result.transaction('entries', 'readonly').objectStore('entries').count();
    const n = await new Promise<number>((resolve) => { get.onsuccess = () => resolve(get.result); });
    request.result.close();
    return n;
  });
  expect(count).toBe(1);
});
