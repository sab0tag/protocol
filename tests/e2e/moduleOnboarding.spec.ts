import { expect, test, type Browser, type Page } from '@playwright/test';
import { seed } from './helpers';
const enabled = process.env.VITE_MODULE_POLICY_ENABLED === 'true';
const ids = ['meds', 'water', 'food', 'menu', 'assistant', 'wellbeing', 'workout', 'progress'];
async function rows(page: Page, store: string) {
  return page.evaluate(async (store) => {
    const req = indexedDB.open('protocol'); await new Promise((r) => { req.onsuccess = r; });
    const get = req.result.transaction(store).objectStore(store).getAll(); await new Promise((r) => { get.onsuccess = r; });
    req.result.close(); return get.result;
  }, store);
}
async function fresh(browser: Browser) {
  const ctx = await browser.newContext(), page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00+03:00'));
  await page.goto('./'); await page.evaluate(() => navigator.serviceWorker.ready);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сфотографуйте призначення лікаря');
  return page;
}
async function manual(page: Page) {
  await page.getByRole('button', { name: 'Ввести вручну', exact: true }).click();
  await page.getByRole('button', { name: 'Далі', exact: true }).click();
}
async function final(page: Page) {
  await page.getByRole('button', { name: 'Далі', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('З чого почнемо');
  expect((await rows(page, 'moduleEvents')).filter((e) => e.kind === 'module' || e.kind === 'onboarded')).toEqual([]);
}

for (const scenario of ['four medicines and diet', 'diet only', 'water only', 'empty plan', 'explicit activity', 'weight goal']) {
  test(`clean confirmed onboarding: ${scenario}`, async ({ browser }) => {
    test.skip(!enabled, 'acceptance build');
    const page = await fresh(browser); await manual(page);
    if (scenario.includes('diet')) await page.getByRole('checkbox', { name: 'Глікемія', exact: true }).check();
    if (scenario.startsWith('four')) {
      for (let i = 0; i < 4; i++) {
        await page.getByRole('button', { name: 'Додати призначення', exact: true }).click();
        await page.getByLabel('Назва', { exact: true }).last().fill(`Препарат ${i + 1}`);
        await page.getByLabel('Час', { exact: true }).last().fill('08:00');
        await page.getByLabel(/^Доза/).last().fill('1 таб.');
      }
    }
    if (scenario === 'explicit activity') await page.getByLabel(/Призначена фізична активність/).selectOption('walking');
    await page.getByRole('button', { name: 'Далі', exact: true }).click();
    if (scenario === 'water only') await page.getByLabel('Вода, мл', { exact: true }).fill('2000');
    if (scenario === 'weight goal') await page.getByLabel('Цільова вага, кг', { exact: true }).fill('90');
    await final(page);
    const expected = scenario.startsWith('four') ? ['meds'] : ['food', ...(scenario === 'water only' ? ['water'] : scenario === 'explicit activity' ? ['workout'] : [])];
    await page.getByText('Змінити стартові розділи', { exact: true }).click();
    const checkboxes = page.getByRole('checkbox'); await expect(checkboxes).toHaveCount(9);
    for (let i = 0; i < ids.length; i++) expect(await checkboxes.nth(i).isChecked()).toBe(expected.includes(ids[i]));
    expect(await checkboxes.nth(8).isChecked()).toBe(scenario === 'weight goal');
    if (scenario.startsWith('four')) {
      await checkboxes.nth(0).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Залишити увімкненим', exact: true }).click();
      await expect(checkboxes.nth(0)).toBeChecked();
      expect((await rows(page, 'moduleEvents')).filter((e) => e.kind === 'module')).toEqual([]);
      await page.screenshot({ path: test.info().outputPath('confirmed-starter.png'), fullPage: true });
    }
    await page.getByRole('button', { name: 'Почати', exact: true }).click();
    await expect(page).toHaveURL(/#\/$/);
    const events = await rows(page, 'moduleEvents');
    expect(events.filter((e) => e.kind === 'module' && e.enabled).map((e) => e.module).sort()).toEqual(expected.sort());
    expect(events.filter((e) => e.kind === 'onboarded')).toHaveLength(1);
    expect((await rows(page, 'plan'))[0].onboardedAt).toBe('2026-10-19');
    await expect(page.getByRole('button', { name: 'Мені погано', exact: true })).toBeVisible();
    await page.goto('./#/modules'); await expect(page.getByRole('switch', { name: 'Прогрес і тиждень', exact: true })).not.toBeChecked();
  });
}

test('repeat onboarding preserves choices/date and a new target offers only explicit opt-in', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await fresh(browser); await page.getByRole('button', { name: /^Пропустити/ }).click(); await expect(page).toHaveURL(/#\/$/);
  await page.goto('./#/modules');
  await page.clock.setFixedTime(new Date('2026-10-19T12:01:00+03:00'));
  await page.getByRole('switch', { name: 'Запис їжі', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Запис їжі', exact: true })).not.toBeChecked();
  const before = await rows(page, 'moduleEvents');
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00+03:00'));
  await page.goto('./#/welcome'); await manual(page);
  await page.getByRole('button', { name: 'Далі', exact: true }).click();
  await page.getByLabel('Вода, мл', { exact: true }).fill('2000');
  await page.getByRole('button', { name: 'Далі', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('З чого почнемо');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Почати', exact: true }).click();
  await expect(page).toHaveURL(/#\/plan$/);
  const review = page.getByRole('region', { name: 'Нові призначення й розділи' });
  const water = review.getByRole('checkbox', { name: 'Увімкнути: Вода', exact: true });
  await expect(water).not.toBeChecked();
  expect(await rows(page, 'moduleEvents')).toEqual(before);
  expect((await rows(page, 'plan'))[0].onboardedAt).toBe('2026-10-19');
  await water.check(); await review.getByRole('button', { name: 'Застосувати вибір', exact: true }).click();
  await expect(review).toHaveCount(0);
  await page.goto('./#/modules');
  await expect(page.getByRole('switch', { name: 'Вода', exact: true })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Запис їжі', exact: true })).not.toBeChecked();
  // A later manual plan edit offers again, but declining leaves the history exactly as it was.
  await page.goto('./#/plan');
  const accepted = await rows(page, 'moduleEvents');
  await page.locator('section.rounded-2xl').filter({ has: page.getByRole('heading', { name: 'Цілі', exact: true }) }).getByRole('button', { name: 'Редагувати', exact: true }).click();
  const targets = page.getByRole('dialog', { name: 'Цілі', exact: true });
  await targets.getByLabel('Білок, г', { exact: true }).fill('90');
  await targets.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await expect(review.getByRole('checkbox', { name: 'Увімкнути: Запис їжі', exact: true })).not.toBeChecked();
  await review.getByRole('button', { name: 'Залишити як є', exact: true }).click();
  await expect(review).toHaveCount(0); expect(await rows(page, 'moduleEvents')).toEqual(accepted);
});

test('the final collapsed overrides are saved as manual choices, including progress off before day eight', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await fresh(browser); await manual(page);
  await page.getByRole('button', { name: 'Далі', exact: true }).click(); await final(page);
  await page.getByText('Змінити стартові розділи', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Вода', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Запис їжі', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Прогрес і тиждень', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Прогрес і тиждень', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Вага окремо', exact: true }).check();
  await page.screenshot({ path: '/tmp/protocol-browser-runtime/onboarding-final-part6.png', fullPage: true });
  await page.getByRole('button', { name: 'Почати', exact: true }).click(); await expect(page).toHaveURL(/#\/$/);
  const events = await rows(page, 'moduleEvents');
  for (const module of ['water', 'food', 'progress']) expect(events.find((e) => e.kind === 'module' && e.module === module)).toMatchObject({ source: 'manual', enabled: module === 'water' });
  expect(events.find((e) => e.kind === 'weight')).toMatchObject({ source: 'manual', enabled: true });
  await page.clock.setFixedTime(new Date('2026-11-02T12:00:00+02:00')); await page.reload();
  await page.goto('./#/modules'); await expect(page.getByRole('switch', { name: 'Прогрес і тиждень', exact: true })).not.toBeChecked();
});

test('late day-eight startup opens once; an earlier manual off survives reload and a second visit', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await fresh(browser); await page.getByRole('button', { name: /^Пропустити/ }).click(); await expect(page).toHaveURL(/#\/$/);
  await page.clock.setFixedTime(new Date('2026-11-02T12:00:00+02:00')); await page.reload();
  await page.goto('./#/modules'); await expect(page.getByRole('switch', { name: 'Прогрес і тиждень', exact: true })).toBeChecked();
  await page.reload();
  expect((await rows(page, 'moduleEvents')).filter((e) => e.source === 'automatic')).toHaveLength(1);
  const other = await fresh(browser); await other.getByRole('button', { name: /^Пропустити/ }).click(); await expect(other).toHaveURL(/#\/$/);
  await seed(other, [{ store: 'moduleEvents', value: { id: 'manual-early-off', v: 1, kind: 'module', module: 'progress', enabled: false, source: 'manual', at: '2026-10-20T00:00:00.000Z' } }]);
  await other.clock.setFixedTime(new Date('2026-11-02T12:00:00+02:00')); await other.reload();
  await other.goto('./#/modules'); await expect(other.getByRole('switch', { name: 'Прогрес і тиждень', exact: true })).not.toBeChecked();
  expect((await rows(other, 'moduleEvents')).filter((e) => e.source === 'automatic')).toHaveLength(0);
});
