import { expect, test } from '@playwright/test';
import { device, seed, toast, ymd } from './helpers';

test('«Зараз»: «Нагадати за 15 хв» hides it for 15 min; +250 мл with undo; a workout says it was saved', async ({ browser }) => {
  const page = await device(browser);
  const now = new Date(), d = ymd(now);
  const at = (minAgo: number) => { const x = new Date(now.getTime() - minAgo * 60_000); return `${d}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}:00+03:00`; };
  test.skip(now.getHours() < 1, 'needs a past time today');
  await seed(page, [{ store: 'entries', value: { id: 'm1', at: at(30), kind: 'meal', status: 'planned', title: 'Обід', items: [{ foodId: 'kefir', name: 'Кефір 2,5 %', grams: 250 }] } }]);
  const card = page.getByRole('region', { name: 'Зараз' });
  await expect(card).toBeVisible();
  const first = await card.innerText();
  await card.getByRole('button', { name: /Нагадати/ }).click();
  await expect(toast(page)).toContainText('Нагадаю через 15 хв');
  if (/Обід/.test(first)) await expect(card.getByText('Обід')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '+250 мл' }).first().click();
  await expect(toast(page)).toContainText('+250 мл води');
  await toast(page).getByRole('button', { name: 'Скасувати' }).click();
  await expect(page.getByText(/^0 \/ \d+ мл/)).toBeVisible();

  await page.goto('./#/workout');
  await page.getByRole('button', { name: 'Записати тренування' }).click();
  await expect(toast(page)).toHaveText(/Тренування записано/);
});

test('«Не відмічено» asks what happened; the dock answers beside itself and adds up (D50)', async ({ browser }) => {
  const page = await device(browser);
  const now = new Date(), d = ymd(now);
  test.skip(now.getHours() < 3, 'needs a meal 2 h ago today');
  const x = new Date(now.getTime() - 120 * 60_000);
  const hm = `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  await seed(page, [{ store: 'entries', value: { id: 'm2', at: `${d}T${hm}:00+03:00`, kind: 'meal', status: 'planned', title: 'Сніданок', items: [] } }]);
  const missed = page.getByRole('region', { name: 'Не відмічено' });
  await expect(missed.getByText('Сніданок')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Зараз' }).getByText('Сніданок')).toHaveCount(0); // not offered as «now»
  await missed.getByRole('listitem').filter({ hasText: 'Сніданок' }).getByRole('button', { name: 'З’їдено' }).click();
  await expect(toast(page)).toContainText('Сніданок — виконано');
  await expect(missed.getByText('Сніданок')).toHaveCount(0);

  const dock = page.getByRole('group', { name: 'Ліки й вода' });
  const water = dock.getByRole('button', { name: /Додати 250 мл води/ });
  await water.click();
  await water.click();
  await expect(dock.getByRole('status')).toContainText('+500 мл · 0,5 л');
  await dock.getByRole('button', { name: 'Скасувати' }).click();
  await expect(water).toHaveAttribute('aria-label', /зараз 0 з/);
});

test('the service worker fills reminders in from the phone\'s own data', async ({ browser }) => {
  const page = await device(browser);
  const today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 86_400_000));
  await seed(page, [{ store: 'entries', value: { id: 't1', at: `${tomorrow}T08:00:00+03:00`, kind: 'meal', status: 'planned', title: 'Сніданок',
    items: [{ name: 'Яйце варене', grams: 100 }], menu: { tips: ['Зваріть яйця звечора'] } } }]);
  const cdp = await page.context().newCDPSession(page);
  const regs = new Promise<{ registrationId: string }[]>((res) => cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { if (e.registrations.length) res(e.registrations); }));
  await cdp.send('ServiceWorker.enable');
  const id = (await regs)[0]!.registrationId;
  const shown = async () => (await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.title} — ${n.body}`))).sort();
  // One at a time, and once more if it never shows: under load the browser sometimes drops a push delivered over
  // DevTools before the worker handles it — the browser's loss, not the app's (the app's text is what is checked).
  const push = async (d: object) => {
    const before = (await shown()).length;
    const send = () => cdp.send('ServiceWorker.deliverPushMessage', { origin: 'http://localhost:4318', registrationId: id,
      data: JSON.stringify({ u: './', tag: Math.random().toString(), n: 0, ...d }) });
    await send();
    const arrived = async () => (await shown()).length > before;
    await expect.poll(arrived, { timeout: 5000 }).toBe(true).catch(async () => { await send(); await expect.poll(arrived, { timeout: 10000 }).toBe(true); });
  };
  await push({ t: 'На завтра', b: '—', k: 'evening', d: tomorrow });
  await push({ t: 'На завтра', b: '—', k: 'evening', d: '2031-01-01' });
  await push({ t: 'Ліки', b: '—', k: 'med', h: '08:30', n: 1 });
  await push({ t: 'План на сьогодні', b: '—', k: 'morning', d: today });
  await expect.poll(shown)
    .toEqual(expect.arrayContaining(['На завтра — Зваріть яйця звечора', 'На завтра — Меню на завтра ще не складено — скласти?', '⏰ Ще раз: Ліки — Вітамін D під час їжі']));
});
