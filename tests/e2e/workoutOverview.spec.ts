import { expect, test } from '@playwright/test';
import { device } from './helpers';
test('overview opens exercise details without replacing the hash route or losing unilateral fields', async ({ browser }) => {
  const page = await device(browser); await page.goto('./#/workout');
  await page.getByText('Перейти до вправ', { exact: true }).click();
  await expect(page).toHaveURL(/#\/workout$/);
  await expect(page.getByRole('heading', { name: 'Вправи тренування', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Додати вправу', exact: true })).toBeVisible();
  await page.context().close();
});
