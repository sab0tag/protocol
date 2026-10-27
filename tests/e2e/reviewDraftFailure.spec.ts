import { expect, test } from '@playwright/test';
import { device, seed } from './helpers';
test('an aborted autosave is reported honestly and retry preserves the edited review', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [{ store: 'reviewDrafts', value: {
    id: 'plan-review', v: 1, revision: 'synthetic-revision', at: new Date().toISOString(), source: 'Тестовий документ', note: '', cuts: {},
    lines: [{ key: 'p1', status: 'sure', kind: 'prescription', timing: { input: '08:00, 20:00', perDay: 2 }, prescription: {
      id: 'synthetic-med', kind: 'medication', title: 'Тестове призначення', dose: '1 таб.', source: 'Тестовий документ', schedule: { times: ['08:00', '20:00'] },
    } }],
  } }]);
  await page.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      const stores = typeof args[0] === 'string' ? [args[0]] : Array.from(args[0]);
      if (stores.includes('reviewDrafts') && args[1] === 'readwrite' && localStorage.getItem('test.abortDraft') === '1') {
        localStorage.removeItem('test.abortDraft'); queueMicrotask(() => tx.abort());
      }
      return tx;
    };
  });
  await page.goto('./#/plan/scan'); await page.reload();
  await page.getByRole('button', { name: 'Продовжити перевірку', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Стан чернетки' })).toHaveText('Чернетку збережено на пристрої');
  await page.evaluate(() => localStorage.setItem('test.abortDraft', '1'));
  await page.getByRole('textbox', { name: 'Час прийому: Тестове призначення', exact: true }).fill('09:00, 21:00');
  await expect(page.getByRole('status', { name: 'Стан чернетки' })).toContainText('Чернетку не збережено');
  await page.getByRole('button', { name: 'Повторити збереження чернетки', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Стан чернетки' })).toHaveText('Чернетку збережено на пристрої');
  await page.reload(); await page.getByRole('button', { name: 'Продовжити перевірку', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Час прийому: Тестове призначення', exact: true })).toHaveValue('09:00, 21:00');
  await page.getByRole('button', { name: 'Зберегти на потім', exact: true }).click();
  await page.getByRole('button', { name: 'Видалити чернетку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Фото висновку лікаря', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Незавершена перевірка' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Фото висновку лікаря', exact: true })).toBeEnabled();
  await page.context().close();
});
