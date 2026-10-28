import { expect, test } from '@playwright/test';
import { device } from './helpers';

test('manual prescription rejects impossible or partial times and preserves the saved schedule after a cancelled edit', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/plan/prescriptions');
  await page.getByRole('button', { name: 'Додати', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Назва', exact: true }).fill('Тестовий препарат');
  await form.getByRole('textbox', { name: /^Доза/ }).fill('1 таб.');
  const time = form.getByRole('textbox', { name: /^Час прийому/ });
  const save = form.getByRole('button', { name: 'Зберегти', exact: true });
  for (const raw of ['25:99', '24:00', '08:30, 25:99', '08:30,', '8:30, 08:30', '08:30;20:00']) {
    await time.fill(raw);
    await expect(time).toHaveAttribute('aria-invalid', 'true');
    await expect(time).toHaveAttribute('aria-describedby', 'prescription-times-error');
    await expect(form.locator('#prescription-times-error')).toContainText('від 00:00 до 23:59');
    await expect(save).toBeDisabled();
    await time.press('Enter');
    await expect(form).toBeVisible();
    await expect(time).toHaveValue(raw);
  }
  await time.fill('8:30, 20:00');
  await expect(time).toHaveAttribute('aria-invalid', 'false');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(form).toHaveCount(0);
  await expect(page.getByText(/Тестовий препарат.*08:30, 20:00/)).toBeVisible();
  await page.getByRole('button', { name: 'Редагувати: Тестовий препарат', exact: true }).click();
  await expect(time).toHaveValue('08:30, 20:00');
  await time.fill('25:99');
  await expect(save).toBeDisabled();
  await form.getByRole('button', { name: 'Скасувати', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Редагувати: Тестовий препарат', exact: true }).click();
  await expect(time).toHaveValue('08:30, 20:00');
  await expect(form.getByRole('textbox', { name: /^Доза/ })).toHaveValue('1 таб.');
});

test('as-needed prescription saves without clock times and retains its food instruction', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/plan/prescriptions');
  await page.getByRole('button', { name: 'Додати', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Назва', exact: true }).fill('Тест за потреби');
  await form.getByRole('textbox', { name: /^Доза/ }).fill('1 таб.');
  await expect(form.getByRole('button', { name: 'Зберегти', exact: true })).toBeDisabled();
  await form.getByRole('checkbox', { name: /За потреби/ }).check();
  await form.getByRole('checkbox', { name: 'Під час їжі', exact: true }).check();
  await form.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.getByRole('button', { name: 'Редагувати: Тест за потреби', exact: true }).click();
  await expect(form.getByRole('textbox', { name: /^Час прийому/ })).toHaveValue('');
  await expect(form.getByRole('checkbox', { name: /За потреби/ })).toBeChecked();
  await expect(form.getByRole('checkbox', { name: 'Під час їжі', exact: true })).toBeChecked();
});
