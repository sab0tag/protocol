import { expect, test } from '@playwright/test';
import { device } from './helpers';

// Queue 18.11, task 2 (D168): a visible way in for clinics that does not get in the patient's way.

test('«Ще» ends with a quiet «Для лікарів і клінік»; the clinic screens have no patient tabs and no «Ще», «Кабінет клініки», «Назад» goes back', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/more');
  const list = page.getByRole('list').first();
  await expect(list.getByRole('link', { name: 'Для лікарів і клінік' })).toHaveCount(0); // not one of the person's sections
  const entry = page.getByRole('link', { name: 'Для лікарів і клінік', exact: true });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/#\/clinic$/);
  const header = page.locator('header.protocol-app-header');
  await expect(header).toContainText('Кабінет клініки');
  await expect(header.getByRole('link', { name: 'Ще' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Розділи' })).toHaveCount(0);
  await header.getByRole('button', { name: 'Назад' }).click();
  await expect(page).toHaveURL(/#\/more$/);

  await page.goto('./#/clinic/invite?code=' + 'a'.repeat(43));
  await expect(page.getByRole('heading', { name: 'Запрошення до клініки' })).toBeVisible();
  await expect(header).toContainText('Кабінет клініки');
  await expect(page.getByRole('navigation', { name: 'Розділи' })).toHaveCount(0);
  await page.context().close();
});

test('«Знайомство» has «Я лікар або працюю в клініці» at the bottom: a doctor goes to the clinic, not through the patient steps', async ({ browser }) => {
  const ctx = await browser.newContext(); const page = await ctx.newPage(); // a first run: «Знайомство», nothing skipped
  await page.goto('./');
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByRole('navigation', { name: 'Розділи' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Я лікар або працюю в клініці', exact: true }).click();
  await expect(page).toHaveURL(/#\/clinic$/);
  await expect(page.getByRole('heading', { name: 'Кабінет клініки', level: 1 })).toBeVisible();
  await page.locator('header.protocol-app-header').getByRole('button', { name: 'Назад' }).click();
  await expect(page).toHaveURL(/#\/welcome$/);
  await ctx.close();
});
