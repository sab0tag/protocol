import { expect, test, type Browser } from '@playwright/test';
import { device, seed } from './helpers';
const enabled = process.env.VITE_MODULE_POLICY_ENABLED === 'true';
async function profile(browser: Browser) {
  const page = await device(browser);
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00+02:00'));
  const at = (d: string, hm = '12:00') => new Date(`${d}T${hm}:00`).toISOString();
  await seed(page, [
    { store: 'plan', value: { id: 'main', prescriptions: [{ id: 'med', kind: 'medication', title: 'Препарат', dose: '1 таб.', source: 'Лікар', schedule: { times: ['08:00'] } }],
      constraints: [], modes: [], targets: { proteinG: 100, carbsG: { max: 150 }, waterMl: 2000 }, onboardedAt: '2026-10-01' } },
    ...['2026-10-25', '2026-10-26'].flatMap((date) => [
      { store: 'entries', value: { id: `meal-${date}`, kind: 'meal', status: 'done', at: at(date), title: 'Добровільний запис',
        items: [{ name: 'Страва', grams: 100, manual: { kcal: 500, protein: 100, carbs: 100, fat: 20 } }] } },
      { store: 'entries', value: { id: `complete-${date}`, kind: 'note', status: 'done', at: at(date), title: '', checkKey: 'food:complete' } },
      { store: 'entries', value: { id: `water-${date}`, kind: 'water', status: 'done', at: at(date), title: 'Вода', waterMl: date.endsWith('25') ? 2500 : 1000 } },
      { store: 'workouts', value: { id: `workout-${date}`, date, durationMin: 20, equipment: 'Гиря', exercises: [] } },
    ]),
    { store: 'entries', value: { id: 'dose', kind: 'med', status: 'done', title: 'Препарат', prescriptionId: 'med', checkKey: 'med:med:08:00', at: at('2026-10-25', '08:00') } },
    ...['2026-10-25', '2026-10-28'].map((date) => ({ store: 'moduleEvents', value: { id: `light-${date}`, v: 1, kind: 'light-day', enabled: true, source: 'manual', date, at: at(date) } })),
  ]);
  return page;
}

test('dated history and neutral outcomes agree in week, progress, doctor report and print; cancellation restores retained facts', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await profile(browser);
  for (const path of ['/week', '/progress']) {
    await page.goto('./#' + path);
    const history = page.getByRole('region', { name: 'Легкі дні', exact: true });
    await expect(history).toContainText('Легких днів: 1 з 7');
    await expect(history).toContainText('Дати: 25.10.2026');
    await expect(history).not.toContainText('28.10.2026');
    await expect(history).toContainText('Добровільно записано тренувань у легкі дні: 1');
    const metric = (label: string) => page.locator('dl > div, li.protocol-week-metric').filter({ hasText: label }); // tiles on «Тиждень», rings on «Прогрес»
    await expect(metric('Вода — норма')).toContainText('0 з 1 дн.');
    await expect(metric('Білок ≥ 90 % цілі')).toContainText('1 з 1 дн.');
  }
  await page.goto('./#/report'); await page.getByLabel('З', { exact: true }).fill('2026-10-20');
  await page.getByLabel('По', { exact: true }).fill('2026-10-26');
  const history = page.getByRole('region', { name: 'Легкі дні', exact: true });
  await expect(history).toContainText('Легких днів: 1 з 7');
  await expect(page.getByRole('row').filter({ hasText: 'Вода — норма' })).toContainText('0 з 1');
  await expect(page.getByText(/Ліки: відмічено прийнятими 1 з 2 доз/)).toBeVisible();
  await page.emulateMedia({ media: 'print' }); await expect(history).toBeVisible();
  await page.screenshot({ path: '/tmp/protocol-browser-runtime/light-day-report-part7.png', fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await seed(page, [{ store: 'moduleEvents', value: { id: 'cancel-light', v: 1, kind: 'light-day', enabled: false, source: 'manual', date: '2026-10-25', at: new Date('2026-10-26T23:01:00+02:00').toISOString() } }]);
  await page.getByLabel('З', { exact: true }).fill('2026-10-20');
  await page.getByLabel('По', { exact: true }).fill('2026-10-26');
  await expect(history).toContainText('Легких днів: 0 з 7');
  await expect(page.getByRole('row').filter({ hasText: 'Вода — норма' })).toContainText('1 з 2');
  const records = await page.evaluate(async () => {
    const req = indexedDB.open('protocol'); await new Promise((r) => { req.onsuccess = r; });
    const tx = req.result.transaction(['entries', 'workouts']);
    const e = tx.objectStore('entries').getAll(), w = tx.objectStore('workouts').getAll();
    await new Promise((r) => { tx.oncomplete = r; }); req.result.close(); return { entries: e.result, workouts: w.result };
  });
  expect(records.entries.filter((e) => e.title === 'Добровільний запис')).toHaveLength(2);
  expect(records.workouts).toHaveLength(2);
});

test('ordinary builds preserve prior calculations and do not show light-day history', async ({ browser }) => {
  test.skip(enabled, 'compatibility build');
  const page = await profile(browser); await page.goto('./#/report');
  await page.getByLabel('З', { exact: true }).fill('2026-10-20'); await page.getByLabel('По', { exact: true }).fill('2026-10-26');
  await expect(page.getByRole('region', { name: 'Легкі дні', exact: true })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'Вода — норма' })).toContainText('1 з 2');
});
