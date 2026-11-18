import { expect, test, type Browser, type Page } from '@playwright/test';
import { device, kyivOffset, seed, toast, ymd } from './helpers';

// «Очередь агента» 18.11, task 3 (D169): water in litres; the doctor's norm and the doctor's limit; drinks count.

async function day(browser: Browser, targets: Record<string, number>, rows: { store: string; value: unknown }[] = []): Promise<Page> {
  const page = await device(browser, 'skip');
  const now = new Date(); now.setHours(12, 0, 0, 0);
  await page.clock.setFixedTime(now);
  await seed(page, [{ store: 'plan', value: { id: 'main', onboardedAt: '2026-10-01', constraints: [], modes: [], prescriptions: [], targets } }, ...rows]);
  await page.goto('./#/'); await page.reload();
  return page;
}
const at = (hm: string) => { const d = new Date(); d.setHours(12, 0, 0, 0); return `${ymd(d)}T${hm}:00${kyivOffset(d)}`; };
const drank = (id: string, ml: number, hm = '09:00') => ({ store: 'entries', value: { id, at: at(hm), kind: 'water', status: 'done', title: 'Вода', waterMl: ml } });
const tile = (page: Page) => page.getByRole('navigation', { name: 'Швидкі відмітки', exact: true }).getByRole('button', { name: /^(Вода|Рідина):/ });

test('a norm: «1,0 з 2,5 л»; reached — «норму виконано», then «+0,25 л понад»', async ({ browser }) => {
  const page = await day(browser, { waterMl: 2500 }, [drank('a', 1000)]);
  await expect(tile(page)).toHaveAccessibleName('Вода: 1,0 з 2,5 л');
  await expect(tile(page)).toContainText('1,0 з 2,5 л');
  await page.context().close();

  const full = await day(browser, { waterMl: 2500 }, [drank('a', 2500)]);
  await expect(tile(full)).toHaveAccessibleName('Вода: 2,5 л — норму виконано');
  await tile(full).click();
  await expect(toast(full)).toContainText('+250 мл · 2,5 л — норму виконано');
  await expect(tile(full)).toHaveAccessibleName('Вода: 2,5 л — норму виконано, +0,25 л понад');
  await expect(tile(full)).toContainText('+0,25 л понад');
  await full.context().close();
});

test('a limit counts tea and soup; «до межі лишилось»; over it calmly, and into the doctor’s report', async ({ browser }) => {
  const page = await day(browser, { waterMaxMl: 1500 }, [drank('a', 600),
    { store: 'entries', value: { id: 'm', at: at('10:00'), kind: 'meal', status: 'done', title: 'Сніданок',
      items: [{ foodId: 'tea', name: 'Чай без цукру', grams: 250 }, { foodId: 'soup-veg', name: 'Суп овочевий', grams: 300 }] } }]);
  await expect(tile(page)).toHaveAccessibleName('Рідина: 1,09 л · межа 1,5 л. До межі лишилось 410 мл');
  await tile(page).click();
  await expect(toast(page)).toContainText('+250 мл · до межі лишилось 160 мл');
  await tile(page).dispatchEvent('contextmenu'); // the long press: the day's water
  const sheet = page.getByRole('dialog', { name: 'Рідина сьогодні' });
  await expect(sheet.getByTestId('water-summary')).toHaveText('рідина 1,34 л з 1,5 (вода 0,85 + чай, суп)');
  await expect(sheet.getByTestId('water-guide')).toHaveCount(0); // never a reference under the doctor's limit
  await sheet.getByRole('button', { name: 'Закрити' }).click();
  await tile(page).click();
  await expect(toast(page)).toContainText('понад межу лікаря на 90 мл');
  await expect(tile(page)).toContainText('+0,09 л понад');
  await expect(page.locator('.text-danger, .bg-danger')).toHaveCount(0); // calm, not red

  // «склянка води» said in the one field says the same
  await page.getByRole('textbox', { name: /Скажіть або напишіть/ }).fill('склянка води');
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('понад межу лікаря на 340 мл');

  await page.goto('./#/report');
  await expect(page.getByTestId('report-water')).toContainText('Межа лікаря 1,5 л: перевищено 1 з 1 дн.');
  await page.context().close();
});

test('no norm: litres today, and the EFSA reference offered as «орієнтир, не призначення лікаря»', async ({ browser }) => {
  const page = await day(browser, {}, [drank('a', 1250)]);
  await expect(tile(page)).toHaveAccessibleName('Вода: 1,25 л сьогодні');
  await tile(page).dispatchEvent('contextmenu');
  const guide = page.getByRole('dialog', { name: 'Вода сьогодні' }).getByTestId('water-guide');
  await expect(guide).toContainText('Орієнтир, не призначення лікаря.');
  await expect(guide).toContainText('Чернетка — ще не перевірено лікарем.');
  await guide.getByRole('button', { name: '1,6 л — жінкам' }).click();
  await expect(toast(page)).toContainText('Орієнтир 1,6 л на день');
  await page.getByRole('dialog', { name: 'Вода сьогодні' }).getByRole('button', { name: 'Закрити' }).click();
  await expect(tile(page)).toHaveAccessibleName('Вода: 1,25 з 1,6 л');
  await page.context().close();
});
