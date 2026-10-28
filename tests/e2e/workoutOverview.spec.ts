import { expect, test } from '@playwright/test';
import { device } from './helpers';
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
