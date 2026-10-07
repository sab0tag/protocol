import { expect, test } from '@playwright/test';
import { device, seed, toast, ymd } from './helpers';

test('«Зараз»: «Пізніше» hides it for 15 min; +250 мл with undo; a workout says it was saved', async ({ browser }) => {
  const page = await device(browser);
  const now = new Date(), d = ymd(now);
  const at = (minAgo: number) => { const x = new Date(now.getTime() - minAgo * 60_000); return `${d}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}:00+03:00`; };
  test.skip(now.getHours() < 1, 'needs a past time today');
  await seed(page, [{ store: 'entries', value: { id: 'm1', at: at(30), kind: 'meal', status: 'planned', title: 'Обід', items: [{ foodId: 'kefir', name: 'Кефір 2,5 %', grams: 250 }] } }]);
  const card = page.getByRole('region', { name: 'Зараз' });
  await expect(card).toBeVisible();
  const first = await card.innerText();
  await card.getByRole('button', { name: /Пізніше/ }).click();
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

test('the service worker fills reminders in from the phone\'s own data', async ({ browser }) => {
  const page = await device(browser);
  const today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 86_400_000));
  await seed(page, [{ store: 'entries', value: { id: 't1', at: `${tomorrow}T08:00:00+03:00`, kind: 'meal', status: 'planned', title: 'Сніданок',
    items: [{ name: 'Яйце варене', grams: 100 }], menu: { tips: ['Зваріть яйця звечора'] } } }]);
  const cdp = await page.context().newCDPSession(page);
  const regs = new Promise<{ registrationId: string }[]>((res) => cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { if (e.registrations.length) res(e.registrations); }));
  await cdp.send('ServiceWorker.enable');
  const id = (await regs)[0]!.registrationId;
  const push = (d: object) => cdp.send('ServiceWorker.deliverPushMessage', { origin: 'http://localhost:4318', registrationId: id, data: JSON.stringify({ u: './', tag: Math.random().toString(), n: 0, ...d }) });
  await push({ t: 'На завтра', b: '—', k: 'evening', d: tomorrow });
  await push({ t: 'На завтра', b: '—', k: 'evening', d: '2031-01-01' });
  await push({ t: 'Ліки', b: '—', k: 'med', h: '08:30', n: 1 });
  await push({ t: 'План на сьогодні', b: '—', k: 'morning', d: today });
  await expect.poll(async () => (await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.title} — ${n.body}`))).sort())
    .toEqual(expect.arrayContaining(['На завтра — Зваріть яйця звечора', 'На завтра — Меню на завтра ще не складено — скласти?', '⏰ Ще раз: Ліки — Вітамін D під час їжі']));
});
