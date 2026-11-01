import { addDays, format } from 'date-fns';
import { expect, test } from '@playwright/test';
import { uk } from 'date-fns/locale';
import { atLocalNoon, device, kyivOffset, seed, ymd } from './helpers';

test('after a week without records the patient can continue today without backfilling missed doses', async ({ browser }) => {
  const page = await device(browser);
  const now = await atLocalNoon(page);
  const previousRecord = addDays(now, -8);
  const previousDate = ymd(previousRecord);

  await seed(page, [{
    store: 'entries',
    value: {
      id: 'synthetic-last-record',
      at: `${previousDate}T12:00:00${kyivOffset(previousRecord)}`,
      kind: 'note',
      status: 'done',
      title: 'Synthetic last record',
    },
  }]);

  await expect(page.getByRole('status', { name: 'Можна продовжити з сьогоднішнього дня' }))
    .toContainText('Не обов’язково заповнювати минулі дні');
  await expect(page.getByRole('region', { name: 'Найближче' })
    .getByRole('button', { name: 'Вітамін D, Не відмічено' })).toBeVisible();

  const entries = await page.evaluate(async () => {
    const request = indexedDB.open('protocol');
    await new Promise<void>((resolve) => { request.onsuccess = () => resolve(); });
    const read = request.result.transaction('entries').objectStore('entries').getAll();
    const rows = await new Promise<{ at: string; status: string }[]>((resolve) => { read.onsuccess = () => resolve(read.result); });
    request.result.close();
    return rows;
  });
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ at: expect.stringContaining(previousDate), status: 'done' });
  expect(entries.some((entry) => entry.status === 'skipped')).toBe(false);

  const nearest = page.getByRole('region', { name: 'Найближче' });
  await nearest.getByRole('button', { name: 'Вітамін D, Не відмічено' }).click();
  await page.getByRole('dialog', { name: 'Вітамін D — коли прийняли?' })
    .getByRole('button', { name: /^Щойно/ }).click();
  await expect(nearest.getByRole('button', { name: /^Вітамін D, Виконано/ })).toBeVisible();

  const pastDate = addDays(now, -1);
  const week = page.getByRole('navigation', { name: 'Тиждень' });
  await week.getByRole('button', { name: format(pastDate, 'EEEE, d MMMM', { locale: uk }) }).click();
  await page.getByRole('button', { name: 'Вітамін D, Не відмічено' }).click();
  await page.getByRole('dialog', { name: 'Вітамін D — коли прийняли?' })
    .getByRole('button', { name: /як за планом/ }).click();

  const afterContinuing = await page.evaluate(async () => {
    const request = indexedDB.open('protocol');
    await new Promise<void>((resolve) => { request.onsuccess = () => resolve(); });
    const read = request.result.transaction('entries').objectStore('entries').getAll();
    const rows = await new Promise<{ at: string; status: string }[]>((resolve) => { read.onsuccess = () => resolve(read.result); });
    request.result.close();
    return rows;
  });
  expect(afterContinuing).toHaveLength(3);
  expect(afterContinuing.some((entry) => entry.status === 'skipped')).toBe(false);
  expect(afterContinuing.some((entry) => entry.status === 'done' && entry.at.startsWith(ymd(now)))).toBe(true);
  expect(afterContinuing.some((entry) => entry.status === 'done' && entry.at.startsWith(ymd(pastDate)))).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Вітамін D, Виконано/ })).toBeVisible();
});
