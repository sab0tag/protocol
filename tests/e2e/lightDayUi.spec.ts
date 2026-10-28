import { expect, test, type Browser, type Page } from '@playwright/test';
import { device, seed, syncOn } from './helpers';
const enabled = process.env.VITE_MODULE_POLICY_ENABLED === 'true';
const noon = new Date('2026-10-25T12:00:00+02:00');
async function rows(page: Page, table: string) {
  return page.evaluate(async (table) => {
    const open = indexedDB.open('protocol'); await new Promise((r) => { open.onsuccess = r; });
    const req = open.result.transaction(table).objectStore(table).getAll(); await new Promise((r) => { req.onsuccess = r; });
    open.result.close(); return req.result;
  }, table);
}
async function profile(browser: Browser, now = noon) {
  const page = await device(browser); await page.clock.setFixedTime(now);
  const date = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await seed(page, [
    { store: 'plan', value: { id: 'main', onboardedAt: '2026-10-01', constraints: [], modes: [], targets: { waterMl: 2000, proteinG: 100, kcal: 2100, lastMealBy: '19:00' },
      prescriptions: [{ id: 'v', kind: 'medication', title: 'Вітамін D', dose: '2000 МО', source: 'Лікар', schedule: { times: ['08:30', '20:30'] } },
        { id: 'prn', kind: 'medication', title: 'Препарат за потреби', dose: '1 таб.', source: 'Лікар', asNeeded: true }] } },
    { store: 'entries', value: { id: 'planned-lunch', kind: 'meal', status: 'planned', title: 'Плановий обід', at: new Date(`${date}T13:00:00`).toISOString(),
      items: [{ name: 'Страва', grams: 100 }], menu: { tips: ['Порада меню'] } } },
  ]);
  return page;
}
async function turnOn(page: Page) {
  await page.getByRole('button', { name: 'Легкий день', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повернути звичайний день', exact: true })).toBeVisible();
}

test('light day quiets non-medication tasks, retains help/PRN and voluntary input, and cancel restores the plan', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await profile(browser);
  await expect(page.getByRole('button', { name: 'Записати їжу', exact: true })).toBeVisible();
  const before = await rows(page, 'entries'); await turnOn(page);
  await expect(page.getByRole('button', { name: 'Записати їжу', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Додати 250 мл води/ })).toHaveCount(0);
  await expect(page.getByText('Плановий обід', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Порада меню', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Помічник — запитати/ })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Швидко' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Мені погано', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сказати голосом', exact: true })).toBeVisible();
  await expect(page.getByText('Препарат за потреби', { exact: true })).toBeVisible();
  expect(await rows(page, 'entries')).toEqual(before);
  const on = (await rows(page, 'moduleEvents')).filter((e) => e.kind === 'light-day');
  expect(on).toHaveLength(1); expect(on[0].until - on[0].from).toBe(25 * 3_600_000);
  await page.screenshot({ path: '/tmp/protocol-browser-runtime/light-day-ui-part8.png', fullPage: true });
  await page.getByText('Записати за бажанням', { exact: true }).click();
  await page.getByRole('button', { name: 'Вода', exact: true }).click();
  const water = page.getByRole('dialog', { name: 'Вода, мл', exact: true });
  await water.getByLabel('Вода, мл', { exact: true }).fill('350'); await water.getByRole('button', { name: 'Записати', exact: true }).click();
  expect((await rows(page, 'entries')).find((e) => e.kind === 'water')?.waterMl).toBe(350);
  await page.getByRole('button', { name: 'Повернути звичайний день', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Записати їжу', exact: true })).toBeVisible();
  expect((await rows(page, 'entries')).find((e) => e.id === 'planned-lunch')).toEqual(before[0]);
});

test('a saved symptom offers light day with wellbeing off; a low saved energy score also offers it', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await profile(browser);
  await page.goto('./#/modules'); await page.getByRole('switch', { name: 'Самопочуття', exact: true }).click();
  await page.goto('./#/'); await page.getByRole('button', { name: 'Мені погано', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Втома', exact: true }).click();
  await dialog.getByRole('button', { name: 'Записати', exact: true }).click();
  await expect(dialog.getByText('Запис збережено', { exact: true })).toBeVisible();
  expect((await rows(page, 'moduleEvents')).filter((e) => e.kind === 'light-day')).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Легкий день', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Повернути звичайний день', exact: true })).toBeVisible();
  expect((await rows(page, 'entries')).filter((e) => e.kind === 'symptom')).toHaveLength(1);
  await page.getByRole('button', { name: 'Повернути звичайний день', exact: true }).click();
  await page.goto('./#/modules'); await page.getByRole('switch', { name: 'Самопочуття', exact: true }).click();
  await page.goto('./#/wellbeing'); await page.getByRole('button', { name: /^Енергія: 1 —/ }).click();
  await expect(page.getByRole('button', { name: 'Легкий день', exact: true })).toBeVisible();
  expect((await rows(page, 'wellbeing'))[0].energy).toBe(1);
});

test('the exact local voice command stays outside the food draft, is idempotent, and never bypasses danger help', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await profile(browser);
  await page.goto('./#/modules'); await page.getByRole('switch', { name: 'Запис їжі', exact: true }).click();
  await page.getByRole('switch', { name: 'Помічник', exact: true }).click();
  const before = await rows(page, 'entries'); await page.goto('./#/do/voice');
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Зрозуміло, говорити' }).click();
  const field = dialog.getByLabel('Або напишіть тут');
  await field.fill('сьогодні легкий день');
  await dialog.getByRole('button', { name: 'Зробити сьогодні легким днем', exact: true }).click();
  await expect(dialog).toContainText('На сьогодні ввімкнено легкий день.');
  await field.fill('сьогодні легкий день'); await dialog.getByRole('button', { name: 'Зробити сьогодні легким днем', exact: true }).click();
  expect((await rows(page, 'moduleEvents')).filter((e) => e.kind === 'light-day')).toHaveLength(1);
  expect(await rows(page, 'entries')).toEqual(before);
  await field.fill('не можу дихати, сьогодні легкий день'); await expect(dialog.getByRole('alert')).toContainText('103');
  await expect(dialog.getByRole('button', { name: 'Записати', exact: true })).toBeDisabled();
});

test('only today has a command; midnight refresh follows today and preserves the old date', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await profile(browser); await turnOn(page);
  await page.goto('./#/?date=2026-10-24');
  await expect(page.getByRole('button', { name: 'Легкий день', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Повернути звичайний день', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'До сьогодні', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повернути звичайний день', exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-10-26T00:00:01+02:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Легкий день', exact: true })).toBeVisible();
  const history = (await rows(page, 'moduleEvents')).filter((e) => e.kind === 'light-day');
  expect(history).toHaveLength(1); expect(history[0].date).toBe('2026-10-25');
  await page.reload(); await expect(page.getByRole('button', { name: 'Легкий день', exact: true })).toBeVisible();
});

test('a visible calm notice is acknowledged once per episode and not repeated after reload', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await profile(browser);
  await seed(page, Array.from({ length: 8 }, (_, i) => {
    const date = `2026-10-${String(18 + i).padStart(2, '0')}`;
    return { store: 'moduleEvents', value: { id: `episode-${date}`, v: 1, kind: 'light-day', date, enabled: true, source: 'manual', at: new Date(`${date}T12:00:00`).toISOString() } };
  }));
  const notice = page.getByRole('region', { name: 'Можна обговорити навантаження', exact: true });
  await expect(notice).toBeVisible();
  await expect.poll(async () => (await rows(page, 'moduleEvents')).filter((e) => e.kind === 'light-day-notice').length).toBe(1);
  await notice.getByRole('button', { name: 'Зрозуміло', exact: true }).click(); await expect(notice).toHaveCount(0);
  await page.reload(); await expect(notice).toHaveCount(0);
});

test('offline light-day changes remain pending until the server acknowledges the current window', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await profile(browser, new Date()); await syncOn(page);
  await page.goto('./#/');
  await expect(page.getByText('Сервер підтвердив налаштування нагадувань.', { exact: true })).toBeVisible();
  await page.context().setOffline(true); await turnOn(page);
  await expect(page.getByText(/Очікуємо підтвердження сервера/)).toBeVisible();
  await page.context().setOffline(false);
  await expect.poll(async () => {
    const meta = (await rows(page, 'meta')).find((e) => e.key === 'sync');
    return meta.reminderPolicyState === 'synced' && JSON.parse(meta.reminderPolicyAck).days.some((d: { enabled: boolean }) => d.enabled);
  }).toBe(true);
  await page.getByRole('button', { name: 'Повернути звичайний день', exact: true }).click();
  await expect.poll(async () => {
    const meta = (await rows(page, 'meta')).find((e) => e.key === 'sync');
    return meta.reminderPolicyState === 'synced' && JSON.parse(meta.reminderPolicyAck).days.some((d: { enabled: boolean }) => !d.enabled);
  }).toBe(true);
});

test('ordinary builds expose no light-day commands', async ({ browser }) => {
  test.skip(enabled, 'compatibility build');
  const page = await profile(browser); await expect(page.getByRole('button', { name: 'Легкий день', exact: true })).toHaveCount(0);
});

test('the real offline worker closes water notifications, keeps medicines, and filters stale push permissions', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await profile(browser, new Date()), ctx = page.context();
  const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    const state = { closed: [] as string[], shown: [] as { tag: string; body: string }[] };
    (self as unknown as { lightTest: typeof state }).lightTest = state;
    Object.defineProperty(self.registration, 'getNotifications', { configurable: true, value: async () => ['med', 'water'].map((k) => ({
      data: { reminder: { k, pv: 1, a: Date.now(), pa: { meds: true, water: true } } }, close: () => state.closed.push(k),
    })) });
    Object.defineProperty(self.registration, 'showNotification', { configurable: true, value: async (_title: string, options: { tag: string; body: string }) => { state.shown.push(options); } });
  });
  await ctx.setOffline(true); await turnOn(page);
  await expect.poll(async () => worker.evaluate(() => (self as unknown as { lightTest: { closed: string[] } }).lightTest.closed)).toContain('water');
  expect(await worker.evaluate(() => (self as unknown as { lightTest: { closed: string[] } }).lightTest.closed)).not.toContain('med');
  const dispatch = (phase: string) => worker.evaluate(async (phase) => {
    const d = new Date(), date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const push = async (payload: object) => {
      const waits: Promise<unknown>[] = [], event = new Event('push');
      Object.defineProperties(event, { data: { value: { json: () => ({ t: 'Reminder', b: 'Generic', a: Date.now(), pv: 1, ...payload }) } }, waitUntil: { value: (p: Promise<unknown>) => waits.push(p) } });
      self.dispatchEvent(event); await Promise.all(waits);
    };
    if (phase === 'on') {
      await push({ k: 'water', d: date, tag: 'blocked-water', pa: { water: true } });
      await push({ k: 'med', h: '08:30', tag: 'kept-med', n: 1 });
      await push({ k: 'morning', d: date, tag: 'filtered-morning' });
      await push({ k: 'visit', tag: 'kept-visit' });
    } else {
      await push({ k: 'water', d: date, tag: 'old-water', a: Date.now() - 60_000 });
      await push({ k: 'water', d: date, tag: 'future-water', a: Date.now() + 60_000 });
    }
    return (self as unknown as { lightTest: { shown: { tag: string; body: string }[] } }).lightTest.shown;
  }, phase);
  const on = await dispatch('on'); expect(on.map((n) => n.tag)).toEqual(['kept-med', 'filtered-morning', 'kept-visit']);
  expect(on[0]?.body).toContain('Вітамін D'); expect(on[1]?.body).not.toContain('Плановий обід');
  await page.getByRole('button', { name: 'Повернути звичайний день', exact: true }).click();
  const off = await dispatch('off'); expect(off.map((n) => n.tag)).not.toContain('old-water'); expect(off.map((n) => n.tag)).toContain('future-water');
});

test('light day never re-enables meds, and danger symptoms do not offer quiet-day actions in place of help', async ({ browser }) => {
  test.skip(!enabled, 'acceptance build');
  const page = await profile(browser); await page.goto('./#/modules');
  await page.getByRole('switch', { name: 'Ліки', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Вимкнути', exact: true }).click();
  await page.goto('./#/'); await turnOn(page);
  await expect(page.getByText('Препарат за потреби', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Вітамін D', { exact: true })).toHaveCount(0);
  await page.goto('./#/modules'); await expect(page.getByRole('switch', { name: 'Ліки', exact: true })).not.toBeChecked();
  await page.goto('./#/'); await page.getByRole('button', { name: 'Повернути звичайний день', exact: true }).click();
  const count = (await rows(page, 'moduleEvents')).filter((e) => e.kind === 'light-day').length;
  await page.getByRole('button', { name: 'Мені погано', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Втома', exact: true }).click();
  await dialog.getByLabel('Своє', { exact: true }).fill('не можу дихати');
  await expect(dialog.getByRole('alert')).toContainText('103');
  await expect(dialog.getByRole('button', { name: 'Легкий день', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Записати', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect((await rows(page, 'moduleEvents')).filter((e) => e.kind === 'light-day')).toHaveLength(count);
});
