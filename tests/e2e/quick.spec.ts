import { expect, test } from '@playwright/test';
import { device, toast } from './helpers';

test('records from a link: water with undo, the medicine (or a word why not), «Мені погано» opens (D66)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/do/water?ml=500');
  await expect(toast(page)).toContainText('+500 мл води');
  const water = page.getByRole('group', { name: 'Ліки й вода' }).getByRole('button', { name: /Додати 250 мл води/ });
  await expect(water).toHaveAttribute('aria-label', /зараз 500 з/);
  await toast(page).getByRole('button', { name: 'Скасувати' }).click();
  await expect(water).toHaveAttribute('aria-label', /зараз 0 з/);

  await page.goto('./#/do/med');
  await expect(toast(page)).toContainText('Вітамін D'); // marked now, or «час минув — відмітьте на «Дні»», by the clock
  await expect(page).toHaveURL(/#\/$/);

  await page.goto('./#/do/symptom');
  await expect(page.getByRole('dialog', { name: 'Що відчуваєте?' })).toBeVisible();

  await page.goto('./#/quick');
  await expect(page.getByText(/#\/do\/water$/)).toBeVisible();
});
