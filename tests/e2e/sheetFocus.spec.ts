import { expect, test } from '@playwright/test';
import { device } from './helpers';
import { t } from '../../src/i18n/uk';

test('prescription sheet wraps Tab in both directions and restores focus on Escape and backdrop close', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/plan/prescriptions');
  const opener = page.getByRole('button', { name: 'Редагувати: Вітамін D', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Редагувати', exact: true });
  const close = dialog.getByRole('button', { name: 'Закрити', exact: true });
  const last = dialog.getByRole('button', { name: 'Видалити', exact: true });
  await last.focus(); await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(last).toBeFocused();
  await page.locator('a[href="#/"]').first().evaluate(element => (element as HTMLElement).focus());
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  expect(await page.locator('nav').first().evaluate(element => !!element.closest('[inert]'))).toBe(true);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  expect(await page.locator('nav').first().evaluate(element => !!element.closest('[inert]'))).toBe(false);
  await opener.click(); await page.mouse.click(1, 1);
  await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
});

test('a symptom sheet recalculates its last tab stop when save becomes enabled', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const opener = page.getByRole('button', { name: 'Мені погано', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  const close = dialog.getByRole('button', { name: 'Закрити', exact: true });
  const save = dialog.getByRole('button', { name: t.symptom.save, exact: true });
  await expect(save).toBeDisabled();
  await close.focus(); await page.keyboard.press('Shift+Tab');
  await expect(save).not.toBeFocused();
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: 'Здуття', exact: true }).click();
  await expect(save).toBeEnabled();
  await close.focus(); await page.keyboard.press('Shift+Tab'); await expect(save).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  await page.keyboard.press('Escape'); await expect(opener).toBeFocused();
});

test('choosing another medicine time preserves input focus and the dynamic form stays inside the sheet', async ({ browser }) => {
  const page = await device(browser);
  const opener = page.getByRole('button', { name: /^Відмітити прийнятим: Вітамін D/ });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: t.mark.other, exact: true }).click();
  const input = dialog.getByLabel(t.mark.other, { exact: true });
  await expect(input).toBeFocused(); await input.fill('09:17'); await expect(input).toBeFocused();
  await expect(input).toHaveValue('09:17');
  const last = dialog.getByRole('button', { name: t.mark.unknown, exact: true });
  await last.focus(); await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Закрити', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
});

test('replacing the add chooser with a note editor retains the original return point', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const opener = page.getByRole('button', { name: 'Додати інше — ліки, тренування, нотатку', exact: true });
  await opener.click();
  await page.getByRole('dialog').getByRole('button', { name: t.addKinds.note, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: t.simple.note, exact: true });
  await expect(dialog.getByRole('textbox', { name: t.simple.title, exact: true })).toBeFocused();
  await dialog.getByRole('textbox', { name: t.simple.title, exact: true }).fill('Тестова чернетка');
  const cancel = dialog.getByRole('button', { name: t.simple.cancel, exact: true });
  await cancel.focus(); await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Закрити', exact: true })).toBeFocused();
  await cancel.click(); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
});
