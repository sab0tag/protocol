import { expect, test } from '@playwright/test';
import { device, seed, ymd, kyivOffset } from './helpers';

test('settings menu exposes profiles and code-based sync with a privacy boundary', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/more/settings');
  await expect(page.getByRole('link', { name: 'Сім’я та профілі', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Синхронізація', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Сім’я та профілі', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Підключити цей профіль кодом' })).toBeVisible();
  await expect(page.getByText(/не надає іншій людині доступ до цих записів/)).toBeVisible();
  await page.getByRole('link', { name: 'Підключити цей профіль кодом' }).click();
  await expect(page).toHaveURL(/#\/sync\?back=%2Fprofiles$/);
  await page.getByRole('button', { name: 'У мене вже є код', exact: true }).click();
  await expect(page.getByLabel('Код з іншого пристрою')).toBeVisible();
  await page.context().close();
});

test('family profiles isolate records and drafts; greeting follows the selected person', async ({ browser }) => {
  const page = await device(browser);
  await seed(page, [{ store: 'entries', value: { id: 'own-water', kind: 'water', status: 'done', at: `${ymd(new Date())}T12:00:00${kyivOffset()}`, waterMl: 250 } }]);
  await page.evaluate(() => localStorage.setItem('protocol.kept.menu', JSON.stringify({ at: Date.now(), v: { drafts: ['own draft'] } })));
  await page.goto('./#/profiles');
  await page.getByRole('button', { name: 'Редагувати профіль: Мій профіль', exact: true }).click();
  await page.getByLabel('Ім’я', { exact: true }).fill('Олена');
  await page.getByRole('button', { name: 'Зберегти профіль', exact: true }).click();
  await page.goto('./#/');
  await expect(page.getByTestId('greeting')).toContainText('Олена');
  await page.getByTestId('greeting').click();
  await page.getByRole('button', { name: 'Додати профіль', exact: true }).click();
  await page.getByLabel('Ім’я', { exact: true }).fill('Данило');
  await page.getByLabel('Ким доводиться').selectOption('child');
  await page.getByRole('button', { name: 'Зберегти профіль', exact: true }).click();
  const directory = await page.evaluate(() => JSON.parse(localStorage.getItem('protocol.profiles.v1')!));
  const child = directory.profiles.find((p: { name: string }) => p.name === 'Данило');
  await page.getByRole('button', { name: 'Відкрити профіль: Данило', exact: true }).click();
  await page.getByRole('button', { name: /^Пропустити/ }).click();
  await expect(page.getByTestId('greeting')).toContainText('Данило');
  const childData = await page.evaluate(async id => {
    const req = indexedDB.open(`protocol-profile-${id}`);
    await new Promise(r => { req.onsuccess = r; });
    const rows = req.result.transaction('entries').objectStore('entries').getAll();
    const entries = await new Promise(r => { rows.onsuccess = () => r(rows.result); }); req.result.close();
    return { entries, draft: localStorage.getItem(`protocol.kept.profile.${id}.menu`) };
  }, child.id);
  expect(childData).toEqual({ entries: [], draft: null });
  await page.goto('./#/do/water?ml=500');
  await expect(page.locator('[role=status][aria-live=polite]')).toContainText('+500 мл');
  await page.reload();
  const childWater = await page.evaluate(async id => {
    const req = indexedDB.open(`protocol-profile-${id}`);
    await new Promise(r => { req.onsuccess = r; });
    const get = req.result.transaction('entries').objectStore('entries').getAll();
    const rows = await new Promise<{ waterMl?: number }[]>(r => { get.onsuccess = () => r(get.result); }); req.result.close();
    return rows.map(row => row.waterMl);
  }, child.id);
  expect(childWater).toEqual([500]);
  // A notification for the original person must restore that profile before navigating.
  await page.goto('./?protocol-profile=main#/');
  await expect(page.getByTestId('greeting')).toContainText('Олена');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('protocol.profiles.v1')!).active)).toBe('main');
  expect(await page.evaluate(() => localStorage.getItem('protocol.kept.menu'))).toContain('own draft');
  const ownWater = await page.evaluate(async () => {
    const req = indexedDB.open('protocol'); await new Promise(r => { req.onsuccess = r; });
    const get = req.result.transaction('entries').objectStore('entries').getAll();
    const rows = await new Promise<{ id: string; waterMl?: number }[]>(r => { get.onsuccess = () => r(get.result); }); req.result.close(); return rows;
  });
  expect(ownWater).toEqual([expect.objectContaining({ id: 'own-water', waterMl: 250 })]);
  // Four responsive/theme states are captured and checked.
  await page.goto('./#/profiles');
  for (const width of [320, 1024]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    await expect(page.getByRole('heading', { name: 'Сім’я та профілі', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/profiles-${width}-${colorScheme}.png`, fullPage: true });
    await page.goto('./#/');
    await expect(page.getByTestId('greeting')).toContainText('Олена');
    const wellbeing = page.getByRole('navigation', { name: 'Швидкі дії' }).getByText('Самопочуття', { exact: true });
    expect((await wellbeing.boundingBox())!.height).toBeLessThan(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/profile-today-${width}-${colorScheme}.png`, fullPage: true });
    await page.goto('./#/profiles');
  }
  await page.context().close();
});


test('greeting updates across time boundaries and a new phrase appears at local midnight', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.clock.install({ time: new Date('2026-10-27T11:59:50+02:00') });
  await page.reload();
  const greeting = page.getByTestId('greeting');
  const phrase = page.locator('.protocol-day-hero p').filter({ has: page.locator('svg') });
  await expect(greeting).toHaveText('Добрий ранок');
  await page.clock.runFor(30000);
  await expect(greeting).toHaveText('Добрий день');
  const text = await phrase.textContent();
  await page.clock.setSystemTime(new Date('2026-10-27T23:59:50+02:00'));
  await page.clock.runFor(30000);
  await expect(greeting).toHaveText('Тихої ночі');
  await expect(phrase).not.toHaveText(text!);
  const next = await phrase.textContent();
  await page.reload();
  await expect(phrase).toHaveText(next!);
  await page.context().close();
});
