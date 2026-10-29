import { expect, test } from '@playwright/test';
import { device, syncOn } from './helpers';
test('overview jumps to the exercises without replacing the hash route', async ({ browser }) => {
  const page = await device(browser); await page.goto('./#/workout');
  await page.getByText('Перейти до вправ', { exact: true }).click();
  await expect(page).toHaveURL(/#\/workout$/);
  await expect(page.getByRole('heading', { name: 'Вправи тренування', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Додати вправу', exact: true })).toBeVisible();
  await page.context().close();
});

test('one exercise at a time: next/back, removing the last one stays in range, another day starts at its first exercise', async ({ browser }) => {
  const page = await device(browser); await page.goto('./#/workout');
  const swaps = page.getByRole('button', { name: /^Замінити: / });
  const n = await swaps.count();
  expect(n).toBeGreaterThan(1);
  await expect(page.getByText('Хвилин — після запису')).toBeVisible(); // not a made-up planned duration
  await page.getByRole('button', { name: 'Тренуватися по одній вправі' }).click();
  const nav = page.getByRole('group', { name: 'Навігація вправами' });
  await expect(nav.getByRole('status')).toHaveText(`Вправа 1 з ${n}`);
  await expect(swaps).toHaveCount(1);
  for (let i = 1; i < n; i++) await nav.getByRole('button', { name: 'Далі →' }).click();
  await expect(nav.getByRole('status')).toHaveText(`Вправа ${n} з ${n}`);
  await expect(nav.getByRole('button', { name: 'Далі →' })).toBeDisabled();
  await page.getByRole('button', { name: /^Прибрати: / }).click();
  await expect(nav.getByRole('status')).toHaveText(`Вправа ${n - 1} з ${n - 1}`);
  await expect(swaps).toHaveCount(1);
  await page.getByRole('button', { name: 'Наступний день' }).click();
  await expect(nav.getByRole('status')).toHaveText(/^Вправа 1 з \d+$/);
  await expect(swaps).toHaveCount(1);
  await page.getByRole('button', { name: 'Показати всі вправи' }).click();
  expect(await swaps.count()).toBeGreaterThan(1);
  await page.context().close();
});

test('one exercise at a time: an AI draft with fewer exercises keeps the shown exercise in range', async ({ browser }) => {
  const page = await device(browser);
  await syncOn(page);
  await page.route('**/workout', (r) => r.fulfill({ json: { advice: 'Коротко сьогодні.', exercises: [{ id: 'swing', sets: 3, reps: 12, seconds: null }] } }));
  await page.goto('./#/workout');
  const n = await page.getByRole('button', { name: /^Замінити: / }).count();
  await page.getByRole('button', { name: 'Тренуватися по одній вправі' }).click();
  const nav = page.getByRole('group', { name: 'Навігація вправами' });
  for (let i = 1; i < n; i++) await nav.getByRole('button', { name: 'Далі →' }).click();
  const panel = page.getByRole('region', { name: 'Скласти тренування з ІІ' });
  await panel.getByRole('button', { name: 'Скласти тренування' }).click();
  await panel.getByRole('button', { name: 'Дозволити й скласти' }).click();
  await expect(page.getByText('Коротко сьогодні.')).toBeVisible();
  await expect(nav.getByRole('status')).toHaveText('Вправа 1 з 1');
  await expect(page.getByRole('button', { name: /^Як виконувати: Махи двома руками/ })).toBeVisible();
  await page.context().close();
});

test('plan against fact: the plan shows as hints, only typed sets count, no minutes are made up (D141)', async ({ browser }) => {
  const page = await device(browser); await page.goto('./#/workout');
  const slots = page.getByRole('spinbutton', { name: /, Підхід \d/ });
  const planned = await slots.count();
  const first = page.getByLabel('Гоблет-присід, Підхід 1', { exact: true });
  await expect(first).toHaveAttribute('placeholder', '10'); // the plan of the set, not a value
  await expect(first).toHaveValue('');
  await expect(page.getByText(`0 з ${planned}`, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Тривалість, хв')).toHaveValue('');
  await first.fill('10');
  await page.getByLabel('Гоблет-присід, Підхід 2', { exact: true }).fill('8');
  await expect(page.getByText(`2 з ${planned}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Записати тренування' }).click();
  await expect(page.getByText('Підходів виконано з плану', { exact: true })).toBeVisible();
  await expect(page.getByText('Факт: 18 повт.', { exact: true })).toBeVisible();
  await expect(page.getByText('Тривалість не вказана', { exact: true })).toBeVisible();
  const stored = await page.evaluate(async () => {
    const open = indexedDB.open('protocol'); await new Promise((r) => { open.onsuccess = r; });
    const get = open.result.transaction('workouts', 'readonly').objectStore('workouts').getAll(); await new Promise((r) => { get.onsuccess = r; });
    open.result.close(); return get.result as { durationMin?: number; exercises: { sets: { reps?: number }[] }[] }[];
  });
  expect(stored).toHaveLength(1);
  expect(stored[0]!.durationMin).toBeUndefined();
  expect(stored[0]!.exercises[0]!.sets.map((s) => s.reps)).toEqual([10, 8, undefined]);
  await page.getByLabel('Тривалість, хв').fill('25');
  await page.getByRole('button', { name: 'Зберегти зміни' }).click();
  await expect(page.getByText('Записано, хв', { exact: true })).toBeVisible();
  await page.context().close();
});
