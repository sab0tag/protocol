import { expect, test } from '@playwright/test';

test('a database that does not answer (as iOS does after the background) shows a way out, not a blank screen', async ({ page }) => {
  await page.addInitScript(() => {
    // IndexedDB that never opens: the request stays pending forever
    const hang = () => ({ result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null,
      addEventListener() {}, removeEventListener() {} });
    Object.defineProperty(window, 'indexedDB', { value: { open: hang, deleteDatabase: hang, cmp: () => 0, databases: async () => [] } });
  });
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('Не вдається прочитати дані', { timeout: 25_000 });
  await expect(page.getByRole('button', { name: 'Перезавантажити' })).toBeVisible();
});
