import { expect, test } from '@playwright/test';
import { device, seed } from './helpers';

for (const width of [320, 1024]) test(`overview navigation preserves the route and unsaved exercise draft at ${width}px`, async ({ browser }) => {
  const page = await device(browser);
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: width === 320 ? 'dark' : 'light' });
  await page.goto('./#/workout');
  const overview = page.getByRole('region', { name: 'Огляд тренування', exact: true });
  await expect(overview).toContainText('План тренування');
  await expect(overview).toContainText('У плані, хв');
  const reps = page.getByRole('spinbutton', { name: /^Гоблет-присід, Підхід 1/ });
  await reps.fill('13');
  await overview.getByRole('button', { name: 'Перейти до вправ', exact: true }).click();
  await expect(page).toHaveURL(/#\/workout$/);
  const heading = page.getByRole('heading', { name: 'Вправи тренування', exact: true });
  await expect(heading).toBeFocused(); await expect(heading).toBeInViewport();
  await expect(reps).toHaveValue('13');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/workout-overview-${width}.png` });
  await page.reload(); await expect(reps).toHaveValue('13');
  const recorded = await page.evaluate(async () => {
    const r = indexedDB.open('protocol'); await new Promise<void>(resolve => { r.onsuccess = () => resolve(); });
    const request = r.result.transaction('workouts').objectStore('workouts').count();
    const count = await new Promise<number>(resolve => { request.onsuccess = () => resolve(request.result); }); r.result.close(); return count;
  });
  expect(recorded).toBe(0);
  await page.context().close();
});

test('recorded overview keeps asymmetric right and left values and does not rewrite the saved workout', async ({ browser }) => {
  const page = await device(browser);
  const date = await page.evaluate(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const workout = { id: 'synthetic-unilateral', date, durationMin: 17, equipment: 'Synthetic', exercises: [{ exerciseId: 'press', name: 'Жим стоячи однією рукою', target: '1 × 12 кожною', sets: [{ side: 'R', reps: 12 }, { side: 'L', reps: 9 }] }] };
  await seed(page, [{ store: 'workouts', value: workout }]);
  await page.goto('./#/workout');
  const overview = page.getByRole('region', { name: 'Огляд тренування', exact: true });
  await expect(overview).toContainText('Записане тренування');
  await expect(overview).toContainText('Записано, хв');
  await expect(overview).toContainText('17');
  await overview.getByRole('button', { name: 'Переглянути вправи', exact: true }).click();
  await expect(page).toHaveURL(/#\/workout$/);
  const sides = page.getByRole('group', { name: 'Жим стоячи однією рукою', exact: true }).getByRole('spinbutton');
  await expect(sides).toHaveCount(2); await expect(sides.nth(0)).toHaveValue('12'); await expect(sides.nth(1)).toHaveValue('9');
  const persisted = await page.evaluate(async () => {
    const r = indexedDB.open('protocol'); await new Promise<void>(resolve => { r.onsuccess = () => resolve(); });
    const q = r.result.transaction('workouts').objectStore('workouts').get('synthetic-unilateral');
    const row = await new Promise<unknown>(resolve => { q.onsuccess = () => resolve(q.result); }); r.result.close(); return row;
  });
  expect(persisted).toEqual(workout);
  await page.context().close();
});
