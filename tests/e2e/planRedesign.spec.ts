import { expect, test } from '@playwright/test';
import { device, seed } from './helpers';

test('plan sources remain profile-scoped and read-only; drafts create no schedule', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, ['main', 'someone-else'].map(personId => ({ store: 'carePlans', value: {
    id: `source-${personId}`, personId, title: `Джерело ${personId}`, status: 'draft', version: 1,
    source: { kind: 'clinic', clinicPlanId: `synthetic-${personId}`, organizationName: 'Синтетична клініка', issuedAt: '2026-11-01' },
  } })));
  await seed(page, ['main', 'someone-else'].map(personId => ({ store: 'carePlanItems', value: {
    id: `item-${personId}`, personId, planId: `source-${personId}`, kind: 'medication',
    provenance: { verification: 'pending', text: 'Синтетичне призначення для перевірки' },
    content: { type: 'prescription', value: { id: `med-${personId}`, title: `Чернетка ${personId}`, kind: 'medication', source: 'Синтетичний документ', schedule: { times: ['08:30'] } } },
  } })));
  const snapshot = () => page.evaluate(async () => {
    const request = indexedDB.open('protocol'); await new Promise(resolve => { request.onsuccess = resolve; });
    const tx = request.result.transaction(['plan', 'carePlans', 'carePlanItems', 'entries']);
    const read = (store: string) => new Promise(resolve => { const get = tx.objectStore(store).getAll(); get.onsuccess = () => resolve(get.result); });
    const values = await Promise.all(['plan', 'carePlans', 'carePlanItems', 'entries'].map(read));
    request.result.close(); return values;
  });
  const before = await snapshot();
  await page.goto('./#/plan');
  const sources = page.getByRole('region', { name: 'Плани та джерела', exact: true });
  await expect(sources.getByRole('heading', { name: 'Джерело main' })).toBeVisible();
  await expect(page.getByText('Джерело someone-else')).toHaveCount(0);
  await expect(sources).toContainText('Імпорт не створює розкладу автоматично');
  await expect(page.getByRole('region', { name: 'Розклад призначень' })).toContainText('Призначень ще немає');
  await sources.getByText('Переглянути джерела', { exact: true }).click();
  await expect(sources).toContainText('Джерело ще не вказане');
  expect(await snapshot()).toEqual(before);
  await page.context().close();
});

test('plan choices preserve consent routes and the mint layout fits approved widths', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/plan');
  await expect(page.getByRole('heading', { name: 'Мій план', level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Розклад призначень' })).toContainText('08:30');
  for (const colorScheme of ['light', 'dark'] as const) for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
    await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${colorScheme}`).toBe(true);
    await page.screenshot({ path: `test-results/plan-redesign-${width}-${colorScheme}.png`, fullPage: true });
  }
  const add = page.getByRole('button', { name: 'Додати план', exact: true });
  await add.click();
  const sheet = page.getByRole('dialog', { name: 'Додати план', exact: true });
  await expect(sheet.getByRole('link', { name: 'QR або посилання від клініки' })).toHaveAttribute('href', '#/plan/import');
  await expect(sheet.getByRole('link', { name: 'Створити самостійно' })).toHaveAttribute('href', '#/plan/prescriptions');
  await page.keyboard.press('Escape'); await expect(add).toBeFocused();
  await add.click(); await sheet.getByRole('link', { name: 'Фото висновку лікаря', exact: true }).click();
  await expect(page).toHaveURL(/#\/plan\/scan$/);
  await expect(page.getByRole('button', { name: 'Фото висновку лікаря', exact: true })).toBeVisible();
  await page.context().close();
});
