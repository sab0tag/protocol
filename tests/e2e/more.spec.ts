import { expect, test } from '@playwright/test';
import { device } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

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

test('a profile photo stays on this device and can be changed or removed', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/more/settings');
  const profile = page.getByRole('region', { name: 'Фото профілю' });
  const upload = profile.getByLabel('Додати фото');
  await upload.setInputFiles({ name: 'profile.png', mimeType: 'image/png', buffer: PNG });
  const avatar = profile.getByRole('img', { name: 'Фото профілю' });
  await expect(avatar).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await expect(profile.getByText('Зберігається лише на цьому пристрої.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Фото профілю' }).getByRole('img', { name: 'Фото профілю' })).toBeVisible();
  await page.getByRole('button', { name: 'Видалити фото' }).click();
  await expect(page.getByRole('img', { name: 'Фото профілю' })).toHaveCount(0);
});

test('every row of «Ще» says in a line what is inside; the link is still named by its title (аудит P3, D154)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/more/settings');
  const data = page.getByRole('link', { name: 'Імпорт / експорт', exact: true });
  await expect(data).toHaveAccessibleDescription('Резервна копія у файл і відновлення з неї.');
  await expect(page.getByRole('link', { name: 'Швидкі дії', exact: true })).toHaveAccessibleDescription(/запис одним дотиком/);
  await page.goto('./#/more/app');
  await expect(page.getByRole('link', { name: 'Пілот', exact: true })).toHaveAccessibleDescription(/лише за згодою/);
  for (const category of ['food', 'health', 'settings', 'app']) {
    await page.goto(`./#/more/${category}`);
    const rows = page.locator('main ul a');
    for (let i = 0; i < await rows.count(); i++) expect(await rows.nth(i).getAttribute('aria-describedby'), `${category} row ${i}`).toBeTruthy();
  }
});
