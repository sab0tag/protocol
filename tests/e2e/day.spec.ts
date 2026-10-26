import { expect, test } from '@playwright/test';
import { device, kyivOffset, seed, toast, ymd } from './helpers';

test('«Зараз»: «Нагадати за 15 хв» hides it for 15 min; water from the dock with undo, counted in «Уже сьогодні»; a workout says it was saved', async ({ browser }) => {
  const page = await device(browser);
  const now = new Date(), d = ymd(now);
  const at = (minAgo: number) => { const x = new Date(now.getTime() - minAgo * 60_000); return `${d}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}:00${kyivOffset(x)}`; };
  test.skip(now.getHours() < 1, 'needs a past time today');
  await seed(page, [{ store: 'entries', value: { id: 'm1', at: at(30), kind: 'meal', status: 'planned', title: 'Обід', items: [{ foodId: 'kefir', name: 'Кефір 2,5 %', grams: 250 }] } }]);
  const card = page.getByRole('region', { name: 'Зараз' });
  await expect(card).toBeVisible();
  const first = await card.innerText();
  await card.getByRole('button', { name: /Нагадати/ }).click();
  await expect(toast(page)).toContainText('Нагадаю через 15 хв');
  if (/Обід/.test(first)) await expect(card.getByText('Обід')).toHaveCount(0);
  await page.reload();
  const dock = page.getByRole('group', { name: 'Ліки й вода' });
  await dock.getByRole('button', { name: /Додати 250 мл води/ }).click();
  await expect(dock.getByRole('status')).toContainText('+250 мл');
  await expect(page.getByText(/^0,25 \/ [\d,]+ л$/)).toBeVisible(); // «Уже сьогодні»
  await dock.getByRole('button', { name: 'Скасувати' }).click();
  await expect(page.getByText(/^0 \/ [\d,]+ л$/)).toBeVisible();

  await page.goto('./#/workout');
  await page.getByRole('button', { name: 'Записати тренування' }).click();
  await expect(toast(page)).toHaveText(/Тренування записано/);
});

test('«Не відмічено» is folded and asks when — or «не пам’ятаю»; the dock answers beside itself and adds up (D50, D52)', async ({ browser }) => {
  const page = await device(browser);
  const now = new Date(), d = ymd(now);
  test.skip(now.getHours() < 3, 'needs a meal 2 h ago today');
  const x = new Date(now.getTime() - 120 * 60_000);
  const hm = `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  await seed(page, [{ store: 'entries', value: { id: 'm2', at: `${d}T${hm}:00${kyivOffset(x)}`, kind: 'meal', status: 'planned', title: 'Сніданок', items: [] } }]);
  const missed = page.getByRole('region', { name: 'Не відмічено' });
  await missed.getByRole('button', { name: /^Не відмічено · \d/ }).click(); // folded by default
  await expect(missed.getByText('Сніданок')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Зараз' }).getByText('Сніданок')).toHaveCount(0); // not offered as «now»
  await missed.getByRole('listitem').filter({ hasText: 'Сніданок' }).getByRole('button', { name: 'Відмітити' }).click();
  const when = page.getByRole('dialog', { name: 'Сніданок — коли з’їли?' }); // D52: no invented time
  await expect(when.getByRole('button', { name: new RegExp(`О ${hm} — як за планом`) })).toBeVisible();
  await when.getByRole('button', { name: 'Час не пам’ятаю' }).click();
  await expect(toast(page)).toContainText('Сніданок — відмічено, час невідомий');
  await expect(missed.getByText('Сніданок')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Сніданок, Виконано, час невідомий/ })).toContainText('—');

  const dock = page.getByRole('group', { name: 'Ліки й вода' });
  const water = dock.getByRole('button', { name: /Додати 250 мл води/ });
  await water.click();
  await water.click();
  await expect(dock.getByRole('status')).toContainText('+500 мл · 0,5 л');
  await dock.getByRole('button', { name: 'Скасувати' }).click();
  await expect(water).toHaveAttribute('aria-label', /зараз 0 з/);
});

test('the new «День»: the plan on an empty day, a dose asks when, main numbers by choice, the week strip (D53)', async ({ browser }) => {
  const page = await device(browser);
  const rhythm = page.getByRole('region', { name: 'Ритм дня' });
  await expect(rhythm.getByRole('button', { name: 'Вітамін D, Заплановано' })).toBeVisible(); // nothing recorded, the plan is there
  await rhythm.getByRole('button', { name: 'Вітамін D, Заплановано' }).click();
  await page.getByRole('dialog', { name: 'Вітамін D — коли прийняли?' }).getByRole('button', { name: /^Щойно/ }).click();
  await expect(toast(page)).toContainText(/Вітамін D — відмічено о \d\d:\d\d/);
  await expect(rhythm.getByRole('button', { name: /^Вітамін D, Виконано/ })).toBeVisible();

  const summary = page.getByRole('region', { name: 'Уже сьогодні' });
  await expect(summary.getByText('Білок')).toHaveCount(0);
  await summary.getByRole('button', { name: 'Налаштувати' }).click();
  const protein = summary.getByRole('checkbox', { name: 'Білок' });
  await expect(protein).toBeDisabled(); // three main metrics are selected; no silent replacement
  await summary.getByRole('checkbox', { name: 'Вода' }).uncheck();
  await expect(protein).toBeEnabled();
  await expect(summary.getByRole('checkbox', { name: 'Ліки' })).toBeDisabled(); // keep at least two
  await protein.check();
  await expect(summary.locator('input[type="checkbox"]:checked')).toHaveCount(3);
  await summary.getByRole('button', { name: 'Готово' }).click();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Уже сьогодні' }).getByText('Білок')).toBeVisible(); // kept on this device

  const week = page.getByRole('navigation', { name: 'Тиждень' });
  await week.getByRole('button', { name: 'Попередній тиждень' }).click();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Сьогодні');
  await page.getByRole('button', { name: 'До сьогодні' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сьогодні');
});

test('«Як учора» stays on «День» and copies a prior meal to today', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const previous = new Date();
  previous.setDate(previous.getDate() - 1);
  const date = ymd(previous);
  await seed(page, [{
    store: 'entries',
    value: { id: 'yesterday-meal', at: `${date}T13:00:00${kyivOffset(previous)}`, kind: 'meal', status: 'done', title: 'Обід',
      items: [{ foodId: 'kefir', name: 'Кефір 2,5 %', grams: 250 }] },
  }]);

  const quick = page.getByRole('navigation', { name: 'Швидко' });
  await expect(quick.getByRole('button')).toHaveCount(4);
  const rhythm = page.getByRole('region', { name: 'Ритм дня' });
  await rhythm.getByRole('button', { name: 'Як учора' }).click();
  const sheet = page.getByRole('dialog', { name: 'Повторити з учора' });
  await expect(sheet.getByText('Кефір 2,5 % 250 г')).toBeVisible();
  await sheet.getByRole('button', { name: /13:00 · Обід/ }).click();
  await expect(toast(page)).toContainText('Обід');
  await expect(page.getByRole('region', { name: 'Ритм дня' })).toContainText('Обід');

  await page.goto('./#/meal/new');
  await expect(page.getByText(/^Як раніше ·/)).toHaveCount(0);
});

test('an empty Day rhythm keeps one explanation and leaves food recording as the action', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const rhythm = page.getByRole('region', { name: 'Ритм дня' });
  await expect(rhythm.getByText('На цей день ще нічого немає.')).toBeVisible();
  await expect(rhythm.getByRole('button', { name: 'Як учора' })).toBeVisible();
  await expect(rhythm.getByRole('button', { name: 'Додати інше — ліки, тренування, нотатку' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Записати їжу' })).toBeVisible();
});

test('a once-daily medicine without a time is not followed by the empty-rhythm message', async ({ browser }) => {
  const page = await device(browser);
  await page.evaluate(async () => {
    const request = indexedDB.open('protocol');
    const database = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result); });
    const transaction = database.transaction('plan', 'readwrite');
    const store = transaction.objectStore('plan');
    const get = store.get('main');
    const plan = await new Promise<Record<string, unknown>>((resolve) => { get.onsuccess = () => resolve(get.result); });
    const prescriptions = plan.prescriptions as { schedule?: { times?: string[]; [key: string]: unknown }; [key: string]: unknown }[];
    store.put({ ...plan, prescriptions: prescriptions.map((prescription) => ({
      ...prescription,
      schedule: { ...prescription.schedule, times: [] },
    })) });
    await new Promise<void>((resolve) => { transaction.oncomplete = () => resolve(); });
    database.close();
  });
  await page.reload();

  const rhythm = page.getByRole('region', { name: 'Ритм дня' });
  await expect(rhythm.getByText('Сьогодні, будь-коли:')).toBeVisible();
  await expect(rhythm.getByRole('button', { name: 'Вітамін D' })).toBeVisible();
  await expect(rhythm.getByText('На цей день ще нічого немає.')).toHaveCount(0);
});

test('«Нічого з цього» skips the planned meal and undo restores the plan', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const now = new Date();
  const planned = new Date(now.getTime() + 45 * 60_000);
  test.skip(ymd(planned) !== ymd(now), 'needs a future meal on the same day');
  const time = `${String(planned.getHours()).padStart(2, '0')}:${String(planned.getMinutes()).padStart(2, '0')}`;
  await seed(page, [{
    store: 'entries',
    value: { id: 'skip-confirmation', at: `${ymd(planned)}T${time}:00${kyivOffset(planned)}`, kind: 'meal', status: 'planned', title: 'Обід',
      items: [{ foodId: 'kefir', name: 'Кефір 2,5 %', grams: 250 }], menu: {} },
  }]);

  const rhythm = page.getByRole('region', { name: 'Ритм дня' });
  await rhythm.getByRole('button', { name: /^Обід, Заплановано/ }).click();
  await page.getByRole('dialog', { name: 'Підтвердити: Обід' }).getByRole('button', { name: 'Нічого з цього' }).click();
  await expect(toast(page)).toContainText('Обід — пропущено');
  await expect(rhythm.getByRole('button', { name: /^Обід, Пропущено/ })).toBeVisible();

  await toast(page).getByRole('button', { name: 'Скасувати' }).click();
  await expect(rhythm.getByRole('button', { name: /^Обід, Заплановано/ })).toBeVisible();
});

test('«Мені погано»: a symptom with its time, what was eaten before it, and «103» for a danger sign (D56)', async ({ browser }) => {
  const page = await device(browser);
  const now = new Date(), d = ymd(now);
  test.skip(now.getHours() < 2, 'needs a meal an hour ago today');
  const x = new Date(now.getTime() - 60 * 60_000);
  const hm = `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  await seed(page, [{ store: 'entries', value: { id: 'k', at: `${d}T${hm}:00${kyivOffset()}`, kind: 'meal', status: 'done', title: 'Перекус',
    items: [{ foodId: 'kefir', name: 'Кефір 2,5 %', grams: 250 }] } }]);
  await page.getByRole('button', { name: 'Мені погано' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Що відчуваєте?' });
  await expect(sheet.getByRole('region', { name: /^Що їли за 6 год/ })).toContainText('Кефір 2,5 %');
  await expect(sheet.getByRole('region', { name: /^Що їли за 6 год/ })).toContainText('Містить: молоко'); // D57
  await sheet.getByRole('button', { name: 'Важко дихати' }).click();
  await expect(sheet.getByRole('alert')).toContainText('103');
  await expect(sheet.getByRole('link', { name: 'Подзвонити 103' })).toHaveAttribute('href', 'tel:103');
  await sheet.getByRole('button', { name: 'Важко дихати' }).click();
  await expect(sheet.getByRole('alert')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Здуття' }).click();
  await sheet.getByRole('button', { name: 'Помірно' }).click();
  await sheet.getByRole('button', { name: 'Записати' }).click();
  await expect(toast(page)).toContainText('Здуття — записано');
  const node = page.getByRole('region', { name: 'Ритм дня' }).getByRole('button', { name: 'Здуття, Симптом' });
  await expect(node).toContainText('Симптом · помірно');
  await node.click();
  await expect(page.getByRole('dialog', { name: 'Здуття' })).toContainText('Кефір 2,5 %');
  await expect(page.getByRole('dialog', { name: 'Здуття' }).getByRole('button', { name: 'Виконано' })).toHaveCount(0);
});

test('the service worker fills reminders in from the phone\'s own data', async ({ browser }) => {
  const page = await device(browser);
  const today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 86_400_000));
  await seed(page, [{ store: 'entries', value: { id: 't1', at: `${tomorrow}T08:00:00${kyivOffset()}`, kind: 'meal', status: 'planned', title: 'Сніданок',
    items: [{ name: 'Яйце варене', grams: 100 }], menu: { tips: ['Зваріть яйця звечора'] } } }]);
  const cdp = await page.context().newCDPSession(page);
  const regs = new Promise<{ registrationId: string }[]>((res) => cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { if (e.registrations.length) res(e.registrations); }));
  await cdp.send('ServiceWorker.enable');
  const id = (await regs)[0]!.registrationId;
  const shown = async () => (await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.title} — ${n.body}`))).sort();
  // Each push is checked right after it, by its own text: under load the browser may drop a push delivered over
  // DevTools, or clear notifications it already showed — the browser's doing, not the app's. What is tested is the
  // text the worker builds from the phone's own data; a push that never shows is sent once more.
  const push = async (d: object, text: string) => {
    const send = () => cdp.send('ServiceWorker.deliverPushMessage', { origin: 'http://localhost:4318', registrationId: id,
      data: JSON.stringify({ u: './', tag: Math.random().toString(), n: 0, ...d }) });
    await send();
    const has = async () => (await shown()).includes(text);
    await expect.poll(has, { timeout: 5000 }).toBe(true).catch(async () => { await send(); await expect.poll(has, { timeout: 10000 }).toBe(true); });
  };
  await push({ t: 'На завтра', b: '—', k: 'evening', d: tomorrow }, 'На завтра — Зваріть яйця звечора');
  await push({ t: 'На завтра', b: '—', k: 'evening', d: '2031-01-01' }, 'На завтра — Меню на завтра ще не складено — скласти?');
  await push({ t: 'Ліки', b: '—', k: 'med', h: '08:30', n: 1 }, '⏰ Ще раз: Ліки — Вітамін D 2000 МО під час їжі');
  await push({ t: 'План на сьогодні', b: '—', k: 'morning', d: today }, 'План на сьогодні — ліки: 08:30');
  await push({ t: 'Вода', b: '—', k: 'water', d: today }, 'Вода — Випито 0 з 2,5 л — склянка води?'); // D70
});
