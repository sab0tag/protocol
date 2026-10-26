import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { device, seed } from './helpers';

test('module history survives restart and a backup restored on an already bootstrapped phone (D134)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const at = new Date().toISOString();
  await seed(page, [{ store: 'moduleEvents', value: { id: 'own-food-off', v: 1, at, kind: 'module', module: 'food', enabled: false, source: 'manual' } },
    { store: 'moduleEvents', value: { id: 'own-light', v: 1, at, kind: 'light-day', date: '2026-10-25', enabled: true, source: 'manual' } },
    { store: 'entries', value: { id: 'water', at, kind: 'water', status: 'done', title: 'Вода', waterMl: 250 } }]);
  // Storage preparation must not start UI filtering before the accounting and scheduler PRs are ready.
  await expect(page.getByRole('link', { name: 'Їжа', exact: true })).toBeVisible();
  await page.goto('./#/data');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Зберегти копію' }).click();
  const path = await (await download).path();
  expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  const backup = JSON.parse(bytes.toString());
  expect(backup.version).toBe(2);
  expect(backup.moduleEvents).toContainEqual(expect.objectContaining({ id: 'own-food-off', enabled: false }));

  const other = await device(browser, 'skip');
  await other.goto('./#/data');
  await other.locator('input[type=file]').setInputFiles({ name: 'protocol.json', mimeType: 'application/json', buffer: bytes });
  await expect(other.getByRole('alertdialog')).toContainText('Для розділів збережеться новіший вибір');
  await other.getByRole('button', { name: 'Так, замінити' }).click();
  await expect(other.getByRole('status')).toContainText('Дані відновлено.');
  await other.reload();
  const records = await other.evaluate(async () => {
    const request = indexedDB.open('protocol');
    const db = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['moduleEvents', 'entries']);
    const events = tx.objectStore('moduleEvents').getAll(), entry = tx.objectStore('entries').get('water');
    const value = await new Promise<{ events: unknown[]; entry: { waterMl: number } }>((resolve) => {
      tx.oncomplete = () => resolve({ events: events.result, entry: entry.result });
    });
    db.close(); return value;
  });
  expect(records.events).toContainEqual(expect.objectContaining({ id: 'own-food-off', enabled: false }));
  expect(records.events).toContainEqual(expect.objectContaining({ id: 'own-light', enabled: true }));
  expect(records.entry.waterMl).toBe(250);
});
