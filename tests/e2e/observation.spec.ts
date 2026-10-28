import { expect, test } from '@playwright/test';
import { clearModules, device, seed } from './helpers';
import { t } from '../../src/i18n/uk';

// Run normally to verify preparation compatibility, and with VITE_MODULE_POLICY_ENABLED=true to exercise the policy.
const enabled = process.env.VITE_MODULE_POLICY_ENABLED === 'true';

test('food/water observation periods are shared by the doctor report and week, behind the rollout switch (D135)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.clock.setFixedTime(new Date('2026-10-30T12:00:00+02:00'));
  const rows = await page.evaluate(() => {
    const at = (d: string, hm = '00:00') => new Date(`${d}T${hm}:00`).toISOString();
    const modules = ['meds', 'water', 'food', 'menu', 'assistant', 'wellbeing', 'workout', 'progress'];
    return [
      { store: 'plan', value: { id: 'main', prescriptions: [{ id: 'p', kind: 'medication', title: 'Препарат', dose: '1 табл.', source: 'Лікар',
        since: '2026-10-01', schedule: { times: ['08:00', '20:00'] } }], constraints: [], modes: [], onboardedAt: '2026-10-01',
        targets: { proteinG: 100, carbsG: { max: 150 }, waterMl: 2000 } } },
      ...modules.map((module) => ({ store: 'moduleEvents', value: { id: `test-init-${module}`, v: 1, at: at('2026-10-01'), kind: 'module', module,
        enabled: module === 'meds' || module === 'progress', source: 'onboarding' } })),
      { store: 'moduleEvents', value: { id: 'test-food-on', v: 1, at: at('2026-10-23'), kind: 'module', module: 'food', enabled: true, source: 'manual' } },
      { store: 'moduleEvents', value: { id: 'test-water-on', v: 1, at: at('2026-10-24'), kind: 'module', module: 'water', enabled: true, source: 'manual' } },
      ...['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'].flatMap((date) => [
        { store: 'entries', value: { id: `${date}-meal`, at: at(date, '12:00'), kind: 'meal', status: 'done', title: 'Їжа',
          items: [{ name: 'Страва', grams: 100, manual: { kcal: 500, protein: 100, carbs: 100, fat: 20 } }] } },
        { store: 'entries', value: { id: `${date}-full`, at: at(date, '23:59'), kind: 'note', status: 'done', title: '', checkKey: 'food:complete' } },
        { store: 'entries', value: { id: `${date}-water`, at: at(date, '12:00'), kind: 'water', status: 'done', title: 'Вода', waterMl: 2000 } },
      ]),
    ];
  });
  await clearModules(page);

  await seed(page, rows);
  if (enabled) {
    await page.goto('./#/');
    const summary = page.getByRole('region', { name: 'Сьогодні' });
    await expect(summary.getByRole('progressbar')).toHaveCount(3);
    await summary.getByRole('button', { name: 'Налаштувати' }).click();
    await expect(summary.getByText('Оберіть 2–3 головні показники; решта — в «Усі показники».')).toBeVisible();
    await expect(summary.getByRole('checkbox', { name: 'Ліки' })).toBeChecked();
    await summary.getByRole('button', { name: 'Готово' }).click();
  }
  await page.goto('./#/report');
  await page.getByLabel('З', { exact: true }).fill('2026-10-20');
  await page.getByLabel('По', { exact: true }).fill('2026-10-24');
  await expect(page.getByRole('row').filter({ hasText: 'Вуглеводи в межах' })).toContainText(enabled ? '2 з 2' : '4 з 4');
  await expect(page.getByRole('row').filter({ hasText: 'Вода — норма' })).toContainText(enabled ? '1 з 1' : '4 з 4');
  if (enabled) {
    await expect(page.getByText(/Запис їжі: увімкнено з 23\.10\.2026/)).toBeVisible();
    await expect(page.getByText('Тренувань', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Без відмітки: 8 доз.', { exact: true })).toBeVisible();
  } else await expect(page.getByText(/Запис їжі: увімкнено з/)).toHaveCount(0);

  await page.clock.setFixedTime(new Date('2026-10-24T12:00:00+03:00'));
  await page.goto('./#/week');
  const food = page.locator('dl > div').filter({ has: page.locator('dt', { hasText: 'Вуглеводи в межах' }) });
  await expect(food).toContainText(enabled ? '2 з 2 дн.' : '4 з 4 дн.');
  await page.goto('./#/progress/motivation');
  const motivationFood = page.locator('dl > div').filter({ has: page.locator('dt', { hasText: 'Вуглеводи в межах' }) });
  await expect(motivationFood).toContainText(enabled ? '2 з 2 дн.' : '4 з 4 дн.');
});

test('the day summary adapts when only one metric is being observed (D135)', async ({ browser }) => {
  test.skip(!enabled, 'the module policy is enabled only in the D135 rollout run');
  const page = await device(browser, 'skip');
  await page.clock.setFixedTime(new Date('2026-10-26T10:00:00+02:00'));
  await clearModules(page);
  const modules = ['meds', 'water', 'food', 'menu', 'assistant', 'wellbeing', 'workout', 'progress'];
  await seed(page, [
    { store: 'plan', value: { id: 'main', prescriptions: [{ id: 'metric-med', kind: 'medication', title: 'Ліки',
      dose: '1 табл.', source: 'Лікар', since: '2026-10-01', schedule: { times: ['20:00'] } }], constraints: [], modes: [], onboardedAt: '2026-10-01' } },
    ...modules.map((module) => ({ store: 'moduleEvents', value: { id: `metric-init-${module}`, v: 1,
      at: '2026-10-01T00:00:00.000Z', kind: 'module', module, enabled: module === 'meds', source: 'onboarding' } })),
  ]);
  await page.goto('./#/');
  const summary = page.getByRole('region', { name: 'Сьогодні' });
  await expect(summary.getByRole('progressbar', { name: t.summary.meds, exact: true })).toHaveCount(1);
  await summary.getByRole('button', { name: t.summary.setup }).click();
  await expect(summary.getByText('Оберіть 1–1 головні показники; решта — в «Усі показники».')).toBeVisible();
  await expect(summary.getByRole('checkbox', { name: t.summary.meds, exact: true })).toBeChecked();
});

test('the quick medicine action does not mark a dose while meds observation is off (D135)', async ({ browser }) => {
  test.skip(!enabled, 'the module policy is enabled only in the D135 rollout run');
  const page = await device(browser, 'skip');
  await page.clock.setFixedTime(new Date('2026-10-26T10:00:00+02:00'));
  await clearModules(page);
  const modules = ['meds', 'water', 'food', 'menu', 'assistant', 'wellbeing', 'workout', 'progress'];
  await seed(page, [
    { store: 'plan', value: { id: 'main', prescriptions: [{ id: 'quick-med', kind: 'medication', title: 'Ліки',
      dose: '1 табл.', source: 'Лікар', since: '2026-10-01', schedule: { times: ['08:00'] } }], constraints: [], modes: [], onboardedAt: '2026-10-01' } },
    ...modules.map((module) => ({ store: 'moduleEvents', value: { id: `quick-init-${module}`, v: 1,
      at: '2026-10-01T00:00:00.000Z', kind: 'module', module, enabled: false, source: 'onboarding' } })),
  ]);
  await page.goto('./#/do/med');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Розділ вимкнено'); // D137: a bookmark to a switched-off module explains it, writing nothing
  const marked = await page.evaluate(async () => {
    const req = indexedDB.open('protocol');
    await new Promise((resolve) => { req.onsuccess = resolve; });
    const tx = req.result.transaction('entries', 'readonly');
    const rows = await new Promise<{ kind: string }[]>((resolve) => {
      const get = tx.objectStore('entries').getAll();
      get.onsuccess = () => resolve(get.result);
    });
    req.result.close();
    return rows.filter((row) => row.kind === 'med').length;
  });
  expect(marked).toBe(0);
});
