import { expect, test, type Page } from '@playwright/test';
import { device, openHistory, seed, toast } from './helpers';

// UI-ACTION-01: one detail layout for a record's actions. Two tabs of the same app stand in for a synced second device.
const date = '2026-10-28';
const record = { id: 'outcome', title: 'Тестовий запис', kind: 'meal', status: 'done', at: `${date}T08:30:00+02:00`, items: [] };

async function stored(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('protocol');
    await new Promise(resolve => { open.onsuccess = resolve; });
    const get = open.result.transaction('entries', 'readonly').objectStore('entries').get('outcome');
    await new Promise(resolve => { get.onsuccess = resolve; });
    open.result.close();
    return get.result as Record<string, unknown> | undefined;
  });
}

async function twoTabs(browser: Parameters<typeof device>[0]) {
  const a = await device(browser, 'skip');
  await a.clock.setFixedTime(new Date(`${date}T12:00:00+02:00`));
  await seed(a, [
    { store: 'plan', value: { id: 'main', onboardedAt: date, lastVisit: date, constraints: [], targets: {}, modes: [], prescriptions: [] } },
    { store: 'entries', value: record },
  ]);
  await a.goto('./#/'); await openHistory(a);
  const b = await a.context().newPage();
  await b.goto('./#/'); await openHistory(b);
  return { a, b };
}

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Тестовий запис', exact: true });
const openRecord = async (page: Page) => { await page.getByRole('button', { name: /^Тестовий запис, / }).click(); return sheet(page); };

test('an open action sheet shows the record as it is now when another device changes it', async ({ browser }) => {
  const { a, b } = await twoTabs(browser);
  const shown = await openRecord(a);
  await expect(shown.getByRole('group', { name: 'Дії із записом' }).getByRole('button', { name: 'Повернути в план', exact: true })).toBeVisible();
  await expect(shown.getByRole('status')).toHaveCount(0);

  await (await openRecord(b)).getByRole('button', { name: 'Повернути в план', exact: true }).click();
  await expect(toast(b)).toContainText('план');

  await expect(shown.getByRole('status')).toContainText('Запис змінився, поки вікно було відкрите');
  await expect(shown.getByRole('button', { name: 'Виконано', exact: true })).toBeVisible(); // the actions follow the current outcome
  await expect(shown.getByRole('button', { name: 'Повернути в план', exact: true })).toHaveCount(0);

  await (await openRecord(b)).getByRole('button', { name: 'Видалити', exact: true }).click();
  await expect(shown).toContainText('Цей запис уже видалено');
  await expect(shown.getByRole('group', { name: 'Дії із записом' })).toHaveCount(0);
  await a.context().close();
});

test('a skip confirmed from a stale view writes nothing and says so; undo never overwrites a later change', async ({ browser }) => {
  const { a, b } = await twoTabs(browser);
  await (await openRecord(a)).getByRole('button', { name: 'Пропущено', exact: true }).click();
  const skip = a.getByRole('dialog', { name: 'Пропустити: Тестовий запис' });
  await skip.getByPlaceholder('Що завадило?').fill('Причина зі старого вікна');

  await (await openRecord(b)).getByRole('button', { name: 'Повернути в план', exact: true }).click(); // meanwhile, elsewhere
  await expect.poll(async () => (await stored(a))?.status).toBe('planned');

  await skip.getByRole('button', { name: 'Підтвердити пропуск' }).click();
  await expect(toast(a)).toContainText('Нічого не збережено');
  expect(await stored(a)).toMatchObject({ status: 'planned' });
  expect((await stored(a))?.skipReason).toBeUndefined();

  // A fresh view acts; its undo is refused once the record has changed again elsewhere
  await a.reload(); await openHistory(a);
  await a.getByRole('button', { name: /^Тестовий запис, / }).click();
  await sheet(a).getByRole('button', { name: 'Виконано', exact: true }).click();
  await expect(toast(a)).toContainText('Тестовий запис');
  await b.reload(); await openHistory(b);
  await (await openRecord(b)).getByRole('button', { name: 'Повернути в план', exact: true }).click();
  await expect.poll(async () => (await stored(a))?.status).toBe('planned');
  await toast(a).getByRole('button', { name: /Скасувати|Повернути/ }).click();
  await expect(toast(a)).toContainText('Не скасовано');
  expect(await stored(a)).toMatchObject({ status: 'planned' });
  await a.context().close();
});
