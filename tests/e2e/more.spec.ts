import { expect, test } from '@playwright/test';
import { device } from './helpers';

test('«Мої продукти» is reachable from the «Їжа» category in «Ще»', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/more');
  await expect(page.getByRole('heading', { level: 1, name: 'Додаткові можливості' })).toBeVisible();
  await page.getByRole('link', { name: /^Їжа Помічник, меню, покупки, страви й продукти/ }).click();

  await expect(page).toHaveURL(/#\/more\/food$/);
  await page.getByRole('link', { name: 'Мої продукти' }).click();
  await expect(page).toHaveURL(/#\/foods$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Мої продукти' })).toBeVisible();
});
