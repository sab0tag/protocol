import { expect, test } from '@playwright/test';
import { device, seed, ymd, kyivOffset } from './helpers';

test('family profiles isolate records and drafts; greeting follows the selected person', async ({ browser }) => {
  const page = await device(browser);
  await seed(page, [{ store: 'entries', value: { id: 'own-water', kind: 'water', status: 'done', at: `${ymd(new Date())}T12:00:00${kyivOffset()}`, waterMl: 250 } }]);
  await page.evaluate(() => localStorage.setItem('protocol.kept.menu', JSON.stringify({ at: Date.now(), v: { drafts: ['own draft'] } })));
  await page.goto('./#/profiles');
  await page.getByRole('button', { name: 'Редагувати профіль: Мій профіль', exact: true }).click();
  await page.getByLabel('Ім’я', { exact: true }).fill('Олена');
  await page.getByRole('button', { name: 'Зберегти профіль', exact: true }).click();
  await page.goto('./#/');
  await expect(page.getByTestId('greeting')).toContainText('Олена!');
  await page.getByTestId('greeting').click();
  await page.getByRole('button', { name: 'Додати профіль', exact: true }).click();
  await page.getByLabel('Ім’я', { exact: true }).fill('Данило');
  await page.getByLabel('Ким доводиться').selectOption('child');
  await page.getByRole('button', { name: 'Зберегти профіль', exact: true }).click();
  const directory = await page.evaluate(() => JSON.parse(localStorage.getItem('protocol.profiles.v1')!));
  const child = directory.profiles.find((p: { name: string }) => p.name === 'Данило');
  await page.getByRole('button', { name: 'Відкрити профіль: Данило', exact: true }).click();
  await page.getByRole('button', { name: /^Пропустити/ }).click();
  await expect(page.getByTestId('greeting')).toContainText('Данило!');
  const childData = await page.evaluate(async id => {
    const req = indexedDB.open(`protocol-profile-${id}`);
    await new Promise(r => { req.onsuccess = r; });
    const rows = req.result.transaction('entries').objectStore('entries').getAll();
    const entries = await new Promise(r => { rows.onsuccess = () => r(rows.result); }); req.result.close();
    return { entries, draft: localStorage.getItem(`protocol.kept.profile.${id}.menu`) };
  }, child.id);
  expect(childData).toEqual({ entries: [], draft: null });
  // A notification for the original person must restore that profile before navigating.
  await page.goto('./?protocol-profile=main#/');
  await expect(page.getByTestId('greeting')).toContainText('Олена!');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('protocol.profiles.v1')!).active)).toBe('main');
  expect(await page.evaluate(() => localStorage.getItem('protocol.kept.menu'))).toContain('own draft');
  // Four responsive/theme states are captured and checked with an actual long name.
  await page.goto('./#/profiles');
  for (const width of [320, 1024]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    await expect(page.getByRole('heading', { name: 'Сім’я та профілі', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/profiles-${width}-${colorScheme}.png`, fullPage: true });
  }
  await page.context().close();
});
