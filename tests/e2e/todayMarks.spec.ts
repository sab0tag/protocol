import { expect, test, type Browser, type Page } from '@playwright/test';
import { device, seed, toast } from './helpers';

// ТЗ «упрощение» 17.11, step 3 (D164): «Сьогодні» — compact «Зараз», quick marks, food tiles and «Мені погано» on the first screen.
const enabled = process.env.VITE_MODULE_POLICY_ENABLED === 'true';

async function rows(page: Page, table: string) {
  return page.evaluate(async (table) => {
    const open = indexedDB.open('protocol'); await new Promise((r) => { open.onsuccess = r; });
    const req = open.result.transaction(table).objectStore(table).getAll(); await new Promise((r) => { req.onsuccess = r; });
    open.result.close(); return req.result;
  }, table);
}

/** A newcomer's plan: three medicines (two of them at 08:00, one «з їжею»), a water norm; the clock at 08:10. */
async function morning(browser: Browser, hm = '08:10'): Promise<Page> {
  const page = await device(browser, 'skip');
  const now = new Date(); const [h, m] = hm.split(':').map(Number); now.setHours(h!, m!, 0, 0);
  await page.clock.setFixedTime(now);
  await seed(page, [{ store: 'plan', value: { id: 'main', onboardedAt: '2026-10-01', constraints: [], modes: [], targets: { waterMl: 2000 },
    prescriptions: [
      { id: 'met', kind: 'medication', title: 'Метформін', dose: '500 мг', source: 'Лікар', schedule: { times: ['08:00', '20:00'], withFood: true } },
      { id: 'vit', kind: 'medication', title: 'Вітамін D', dose: '2000 МО', source: 'Лікар', schedule: { times: ['08:00'] } },
      { id: 'cap', kind: 'medication', title: 'Каптоприл', dose: '25 мг', source: 'Лікар', schedule: { times: ['20:00'] } }] } }]);
  await page.goto('./#/'); await page.reload();
  return page;
}
const marks = (page: Page) => page.getByRole('navigation', { name: 'Швидкі відмітки', exact: true });

test('the first screen at 390 × 844 holds «Зараз» with one button and the doctor’s word, the marks, the food tiles and «Мені погано»', async ({ browser }) => {
  const page = await morning(browser);
  await page.setViewportSize({ width: 390, height: 844 });
  const now = page.getByRole('region', { name: 'Зараз', exact: true });
  await expect(now).toContainText('Метформін');
  await expect(now).toContainText(/під час їжі/i);
  await expect(now.getByRole('button')).toHaveCount(2); // «Прийнято» and «⋯» — the rest is behind «⋯»
  await now.getByRole('button', { name: 'Інші дії', exact: true }).click();
  await expect(now.getByRole('button', { name: /^Нагадати за/ })).toBeVisible();
  await now.getByRole('button', { name: 'Інші дії', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/mockup-today-step3-390.png' });
  const fold = 844 - 72 - 64; // above the tab bar and the one field pinned over it
  for (const [name, el] of [['Зараз', now.getByRole('button', { name: /Прийнято/ })], ['marks', marks(page)], ['food', page.getByTestId('meal-tiles').locator('[data-slot]').first()],
    ['Мені погано', page.getByTestId('unwell')]] as const) {
    const box = await el.boundingBox();
    expect(box, name).not.toBeNull();
    expect(box!.y + box!.height, `${name} is on the first screen`).toBeLessThanOrEqual(fold);
  }
  await expect(page.getByText('Цілі на сьогодні')).toHaveCount(0);
  await expect(page.getByText('Ще дії')).toHaveCount(0);
});

test('two doses due at once: «Ліки» opens a list with ticks; a tick marks one, «2 з 4» → «1 з 4»; water is one tap with «Скасувати»', async ({ browser }) => {
  const page = await morning(browser);
  const meds = marks(page).getByRole('button', { name: /^Ліки:/ });
  await expect(meds).toHaveAccessibleName('Ліки: 0 з 4');
  await meds.click();
  const list = page.getByRole('dialog', { name: 'Ліки на зараз', exact: true });
  await expect(list.getByRole('checkbox')).toHaveCount(2); // not one picked at random
  await list.getByRole('checkbox', { name: /Вітамін D/ }).check();
  await expect(toast(page)).toContainText('Вітамін D');
  await list.getByRole('button', { name: 'Закрити', exact: true }).click();
  await expect(meds).toHaveAccessibleName('Ліки: 1 з 4');
  expect((await rows(page, 'entries')).filter((e) => e.kind === 'med' && e.status === 'done')).toHaveLength(1);

  const water = marks(page).getByRole('button', { name: /^Вода:/ });
  await expect(water).toHaveAccessibleName('Вода: 0 з 8');
  await water.click();
  await expect(water).toHaveAccessibleName('Вода: 1 з 8');
  await toast(page).getByRole('button', { name: 'Скасувати' }).click();
  await expect(water).toHaveAccessibleName('Вода: 0 з 8');
  expect((await rows(page, 'entries')).filter((e) => e.kind === 'water')).toHaveLength(0); // the undo removes the record entirely
});

test('wellbeing is a scale in words; «Дуже погано» points to «Мені погано» and opens no 103 itself', async ({ browser }) => {
  const page = await morning(browser);
  await marks(page).getByRole('button', { name: /^Самопочуття:/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Як ви почуваєтеся?', exact: true });
  await expect(sheet.getByRole('group').getByRole('button')).toHaveText(['Дуже погано', 'Погано', 'Так собі', 'Добре', 'Чудово']);
  await sheet.getByRole('button', { name: 'Дуже погано', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Мені погано →', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '103' })).toHaveCount(0);
  expect((await rows(page, 'wellbeing'))[0]).toMatchObject({ mood: 1 });
  await sheet.getByRole('button', { name: 'Мені погано →', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible(); // the same «Мені погано» flow
});

test('shortcuts: /do/meds opens the list for two doses due now, /do/mood the scale, /do/food the meal going on now', async ({ browser }) => {
  const page = await morning(browser);
  await page.goto('./#/do/meds');
  await expect(page.getByRole('dialog', { name: 'Ліки на зараз', exact: true })).toBeVisible();
  expect((await rows(page, 'entries')).filter((e) => e.kind === 'med')).toHaveLength(0);
  await page.goto('./#/do/mood');
  await expect(page.getByRole('dialog', { name: 'Як ви почуваєтеся?', exact: true })).toBeVisible();
  await page.goto('./#/do/food');
  await expect(page.getByTestId('meal-tiles').getByPlaceholder('Додати до сніданку…')).toBeVisible();
  const manifest = await (await page.request.get('./manifest.webmanifest')).json() as { shortcuts: { url: string }[] };
  expect(manifest.shortcuts.map((s) => s.url)).toEqual(['./#/do/meds', './#/do/water', './#/do/mood', './#/do/food']);
});

test('a module switched off has no tile; switched on in «Що показувати», the tile is back without a reload', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await morning(browser);
  await expect(marks(page).getByRole('button', { name: /^Самопочуття:/ })).toBeVisible();
  await page.goto('./#/modules');
  await page.getByRole('switch', { name: 'Самопочуття', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Самопочуття', exact: true })).not.toBeChecked();
  await page.goto('./#/');
  await expect(marks(page).getByRole('button', { name: /^Самопочуття:/ })).toHaveCount(0);
  await page.goto('./#/modules');
  await expect(page.getByRole('switch', { name: 'Самопочуття', exact: true })).not.toBeChecked(); // the saved state is loaded
  await page.getByRole('switch', { name: 'Самопочуття', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Самопочуття', exact: true })).toBeChecked(); // saved before leaving
  await page.evaluate(() => { location.hash = '#/'; }); // in-app navigation, no reload
  await expect(page).toHaveURL(/#\/$/);
  await expect(marks(page).getByRole('button', { name: /^Самопочуття:/ })).toBeVisible(); // no reload
});
