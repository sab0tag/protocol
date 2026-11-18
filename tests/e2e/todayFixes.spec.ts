import { expect, test, type Browser, type Page } from '@playwright/test';
import { device, kyivOffset, seed, ymd } from './helpers';

// Queue 18.11, task 1 (D167): the fixes to step 3 found on main 97c6562 at 390 px, and «Меню» for today. Every case sets the clock.

async function at(browser: Browser, hm: string, start: 'skip' | 'demo' = 'skip'): Promise<Page> {
  const page = await device(browser, start);
  const now = new Date(); const [h, m] = hm.split(':').map(Number); now.setHours(h!, m!, 0, 0);
  await page.clock.setFixedTime(now);
  if (start === 'skip') await seed(page, [{ store: 'plan', value: { id: 'main', onboardedAt: '2026-10-01', constraints: [], modes: [], targets: { waterMl: 2000 },
    prescriptions: [{ id: 'vit', kind: 'medication', title: 'Вітамін D', dose: '2000 МО', source: 'Лікар', schedule: { times: ['08:30'], withFood: true } }] } }]);
  await page.goto('./#/'); await page.reload();
  return page;
}

const contrast = (el: import('@playwright/test').Locator) => el.evaluate((element) => {
  const lum = (c: string) => { const [r, g, b] = c.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return r! * 0.2126 + g! * 0.7152 + b! * 0.0722; };
  let bg = 'rgba(0, 0, 0, 0)';
  for (let n: Element | null = element; n && /rgba\(0, 0, 0, 0\)|transparent/.test(bg); n = n.parentElement) bg = getComputedStyle(n).backgroundColor;
  const a = lum(getComputedStyle(element).color), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
});

test('«Зараз»: an action, not a status; a dose an hour past its time reads «Не відмічено з 08:30», not «Зараз»', async ({ browser }) => {
  const page = await at(browser, '08:40');
  const now = page.getByRole('region', { name: 'Зараз', exact: true });
  await expect(now.getByRole('button', { name: 'Відмітити', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Прийнято', exact: true })).toHaveCount(0);

  const late = await at(browser, '14:10');
  const card = late.getByRole('region', { name: 'Не відмічено з 08:30', exact: true });
  await expect(card).toContainText('Не відмічено з 08:30');
  await expect(card).toContainText('Вітамін D');
  await expect(card).not.toContainText('Зараз');
  await expect(late.getByRole('region', { name: 'Зараз', exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Відмітити', exact: true })).toBeVisible();
  await page.context().close(); await late.context().close();
});

test('«Ліки на сьогодні» says a dose’s time once', async ({ browser }) => {
  const page = await at(browser, '14:10');
  await page.getByRole('navigation', { name: 'Швидкі відмітки', exact: true }).getByRole('button', { name: /^Ліки:/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Ліки на сьогодні', exact: true });
  await expect(sheet).toContainText('08:30 · 2000 МО');
  await expect(sheet).not.toContainText('08:30 · 08:30');
  await page.context().close();
});

test('in the example at 390 × 844 «Мені погано» is above the field; an open tile hides the field and shows all its suggestions', async ({ browser }) => {
  const page = await at(browser, '14:10', 'demo');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  const unwell = (await page.getByTestId('unwell').boundingBox())!, field = (await page.getByTestId('one-input').boundingBox())!;
  expect(unwell.y + unwell.height, '«Мені погано» is not under the field').toBeLessThanOrEqual(field.y);
  const mics = page.getByRole('button', { name: 'Сказати голосом', exact: true });
  const micsBefore = await mics.count();
  expect(micsBefore).toBeLessThanOrEqual(1);

  await page.getByTestId('meal-tiles').getByRole('button', { name: /^Обід/ }).first().click();
  await expect(page.getByTestId('one-input')).toBeHidden();
  await expect(mics).toHaveCount(micsBefore); // the tile's own microphone, not a second one
  await page.getByPlaceholder('Додати до обіду…').fill('гр');
  const list = page.getByRole('list', { name: 'Підказки' });
  await expect(list.getByRole('button').first()).toBeVisible();
  await page.waitForTimeout(600); // the tile scrolls up smoothly
  const box = (await list.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, 'every suggestion is on the screen').toBeLessThanOrEqual(844 - 72);
  await page.getByTestId('meal-tiles').getByRole('button', { name: /^Обід/ }).first().click(); // folded — the field is back
  await expect(page.getByTestId('one-input')).toBeVisible();
  await page.context().close();
});

test('«Меню»: today with only the meals left until 18:00, tomorrow after; chips instead of a calendar; «Що купити» is readable', async ({ browser }) => {
  const page = await at(browser, '14:10');
  await page.goto('./#/menu');
  await expect(page.getByRole('heading', { name: 'Меню на сьогодні', level: 1 })).toBeVisible();
  await expect(page.getByText('Лише те, що лишилося на сьогодні: обід, вечеря.')).toBeVisible(); // breakfast's time is over
  await expect(page.getByRole('button', { name: 'Сьогодні', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('input[type=date]')).toHaveCount(0);
  const shop = page.getByRole('link', { name: 'Що купити' });
  await expect(shop).toBeVisible();
  expect(await contrast(shop), '«Що купити» contrast').toBeGreaterThanOrEqual(4.5);
  await page.getByRole('button', { name: 'Завтра', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Меню на завтра', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Інший день', exact: true }).click();
  await expect(page.getByLabel('Інша дата')).toBeVisible();

  // «Як учора» for today keeps only what is left: yesterday's breakfast stays out
  const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(12, 0, 0, 0);
  const day = ymd(y), off = kyivOffset(y);
  await seed(page, [
    { store: 'entries', value: { id: 'yb', at: `${day}T08:00:00${off}`, kind: 'meal', status: 'done', title: 'Сніданок', items: [{ foodId: 'egg-boiled', name: 'Яйце варене', grams: 100 }] } },
    { store: 'entries', value: { id: 'yd', at: `${day}T19:00:00${off}`, kind: 'meal', status: 'done', title: 'Вечеря', items: [{ foodId: 'kefir', name: 'Кефір 2,5 %', grams: 250 }] } }]);
  await page.getByRole('button', { name: 'Як учора', exact: true }).click();
  await expect(page.getByText('Кефір 2,5 %')).toBeVisible();
  await expect(page.getByText('Яйце варене')).toHaveCount(0);
  await page.context().close();

  const evening = await at(browser, '18:30');
  await evening.goto('./#/menu');
  await expect(evening.getByRole('heading', { name: 'Меню на завтра', level: 1 })).toBeVisible();
  await evening.context().close();
});
