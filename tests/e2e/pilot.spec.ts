import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import { addDays, startOfISOWeek } from 'date-fns';
import { device, seed, ymd } from './helpers';

const pilotCalls = (page: Page) => {
  const calls: { method: string; url: string; body: string | null }[] = [];
  page.context().on('request', (r) => { if (r.url().includes('/v1/pilot')) calls.push({ method: r.method(), url: r.url(), body: r.postData() }); });
  return calls;
};
const source = (code: string) => execFileSync('node', ['--disable-warning=ExperimentalWarning', 'server/src/statsCli.ts', 'pilot', '--source', code, 'Ендокринолог, клініка 1'],
  { env: { ...process.env, DB_PATH: '.e2e/api.db' } });
const rows = (pid: string) => {
  const db = new DatabaseSync('.e2e/api.db', { readOnly: true });
  try { return (db.prepare('SELECT COUNT(*) AS n FROM pilot_weeks WHERE pid = ?').get(pid) as { n: number }).n; } finally { db.close(); }
};
/** Two meals said by voice, one typed, and a medicine ticked — last week, as the phone keeps them. */
const lastWeek = () => {
  const mon = startOfISOWeek(addDays(new Date(), -7)), d = (k: number) => ymd(addDays(mon, k));
  return [
    { store: 'entries', value: { id: 'm1', at: `${d(0)}T13:00:00`, kind: 'meal', status: 'done', title: 'Обід', items: [{ foodId: 'buckwheat-boiled', name: 'Гречка варена', grams: 150 }], via: 'voice' } },
    { store: 'entries', value: { id: 'm2', at: `${d(2)}T13:00:00`, kind: 'meal', status: 'done', title: 'Обід', items: [{ foodId: 'buckwheat-boiled', name: 'Гречка варена', grams: 150 }], via: 'voice' } },
    { store: 'entries', value: { id: 'm3', at: `${d(3)}T08:00:00`, kind: 'meal', status: 'done', title: 'Сніданок', items: [{ foodId: 'buckwheat-boiled', name: 'Гречка варена', grams: 100 }] } },
  ];
};

test('without consent, and in the example, nothing goes to /v1/pilot (D120)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const calls = pilotCalls(page);
  await page.reload();
  await page.goto('./#/pilot');
  await expect(page.getByText('Ви не берете участі. Нічого не надсилається.')).toBeVisible();
  await page.goto('./#/');
  await page.goto('./#/more');
  await page.getByRole('button', { name: 'Подивитись на прикладі' }).click();
  await page.getByRole('button', { name: 'Відкрити приклад' }).click();
  await expect(page.getByText(/Це приклад:/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Допомогти пілоту' })).toHaveCount(0);
  await page.goto('./#/pilot');
  await expect(page.getByText('У прикладі пілот вимкнено: нічого не надсилається.')).toBeVisible();
  await page.waitForTimeout(500);
  expect(calls).toEqual([]);
});

test('a QR card’s code → the consent with last week’s own numbers; what goes is what was shown; «Видалити надіслане» leaves nothing (D120)', async ({ browser }) => {
  source('ENDO-01');
  const page = await device(browser, 'skip');
  const calls = pilotCalls(page);
  await seed(page, lastWeek());
  await page.evaluate(async () => { // back to onboarding, as a person opening the QR link for the first time
    const req = indexedDB.open('protocol'); await new Promise((r) => { req.onsuccess = r; });
    const tx = req.result.transaction('plan', 'readwrite'); const s = tx.objectStore('plan'); const g = s.get('main');
    await new Promise((r) => { g.onsuccess = r; }); s.put({ ...g.result, onboardedAt: undefined });
    await new Promise((r) => { tx.oncomplete = r; }); req.result.close();
  });
  await page.goto('./?src=ENDO-01#/welcome');
  await expect(page.getByText('Код ENDO-01 прийнято')).toBeVisible();
  expect(page.url()).not.toContain('src=');
  expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`)).toEqual(['GET /v1/pilot/src/ENDO-01?visit=1']);
  const consent = page.getByRole('region', { name: 'Допомогти пілоту' });
  await expect(consent).toContainText('записи: голосом 2, вручну 1, з фото 0');
  await expect(consent).toContainText('днів, коли записано їжу: 3 з 7');
  await consent.getByText('Усе, що піде, до останньої цифри').click();
  const shown = await consent.getByTestId('pilot-all').innerText();
  expect(shown).toContain('код лікаря: ENDO-01');
  await consent.getByRole('button', { name: 'Так, надсилати' }).click();
  await expect(consent).toHaveCount(0);
  await expect.poll(() => calls.filter((c) => c.url.endsWith('/v1/pilot/week')).length).toBe(1);
  const sent = JSON.parse(calls.find((c) => c.url.endsWith('/v1/pilot/week'))!.body!) as { pid: string; week: string; food: Record<string, number>; src: string };
  expect(sent.src).toBe('ENDO-01');
  expect(sent.food).toMatchObject({ days_logged: 3, entries: 3, by_voice: 2, by_text: 1 });
  await expect.poll(() => rows(sent.pid)).toBe(1);
  // «Ще → Пілот»: the week as it went — the same words as the sample
  await page.getByText('Інші способи почати').click(); await page.getByRole('button', { name: /^Пропустити/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Сьогодні' })).toBeVisible();
  await page.goto('./#/pilot');
  await expect(page.getByText(/Ви берете участь з/)).toBeVisible();
  const week = page.locator(`[data-week="${sent.week}"]`);
  await week.getByText('Усе, що піде, до останньої цифри').click();
  expect(await week.getByTestId('pilot-all').innerText()).toBe(shown);
  // opening again sends nothing twice
  await page.reload(); await page.waitForTimeout(800);
  expect(calls.filter((c) => c.url.endsWith('/v1/pilot/week')).length).toBe(1);
  await page.getByRole('button', { name: 'Видалити надіслане' }).click();
  await page.getByRole('button', { name: 'Так, видалити' }).click();
  await expect(page.getByText('Ви не берете участі. Нічого не надсилається.')).toBeVisible();
  await expect.poll(() => rows(sent.pid)).toBe(0);
  await page.reload(); await page.waitForTimeout(800);
  expect(calls.filter((c) => c.method === 'POST').map((c) => new URL(c.url).pathname)).toEqual(['/v1/pilot/join', '/v1/pilot/week']); // no new pid without a new consent
});

test('an unknown code: said, and onboarding goes on without it (D120)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('./?src=NOPE-99#/welcome');
  await expect(page.getByText('Код не знайдено — можна продовжити без нього')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Допомогти пілоту' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ввести вручну' })).toBeVisible();
});

test('«Допомогти пілоту?» on «День» from the 3rd day; «Ні» puts it away (D120)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const calls = pilotCalls(page);
  await expect(page.getByRole('region', { name: 'Допомогти пілоту' })).toHaveCount(0);
  await seed(page, [{ store: 'entries', value: { id: 'w', at: `${ymd(addDays(new Date(), -2))}T09:00:00`, kind: 'water', status: 'done', title: 'Вода', waterMl: 250 } }]);
  const offer = page.getByRole('region', { name: 'Допомогти пілоту' });
  await expect(offer).toBeVisible();
  await expect(offer.getByRole('button', { name: 'Так, надсилати' })).toBeVisible();
  await offer.getByRole('button', { name: 'Ні' }).click();
  await expect(offer).toHaveCount(0);
  await page.reload(); await page.waitForTimeout(500);
  await expect(offer).toHaveCount(0);
  expect(calls).toEqual([]);
});

/** A participant who agreed `days` days ago (the day of consent is the 1st). */
const participant = (days: number, surveys: unknown = {}) => [{ store: 'pilot', value: { key: 'pilot',
  consent: { at: `${ymd(addDays(new Date(), -(days - 1)))}T09:00:00.000Z`, version: 1 }, surveys } }];

test('the survey of the 7th day: only a participant sees it, a card on «День»; the answer goes; two «Не зараз» put it away (D121)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const calls = pilotCalls(page);
  await seed(page, participant(6));
  await expect(page.getByRole('region', { name: 'Два питання про застосунок' })).toHaveCount(0); // the 6th day
  await seed(page, participant(7));
  const card = page.getByRole('region', { name: 'Два питання про застосунок' });
  await expect(card).toBeVisible();
  const send = card.getByRole('button', { name: 'Надіслати' });
  await expect(send).toBeDisabled();
  await card.getByRole('group', { name: /Чи допомагає/ }).getByRole('button', { name: '4' }).click();
  await card.getByRole('button', { name: 'забуваю відкрити' }).click();
  await send.click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => calls.filter((c) => c.body?.includes('"survey":"d7"')).length).toBe(1);
  const body = JSON.parse(calls.find((c) => c.body?.includes('"survey"'))!.body!) as { pid: string; q: unknown };
  expect(body.q).toEqual({ helps: 4, blocker: 'forget' });
  await page.reload(); await page.waitForTimeout(500);
  await expect(card).toHaveCount(0);
  // another participant: «Не зараз» once yesterday — today again; the second one — gone
  const other = await device(browser, 'skip');
  await seed(other, participant(8, { d7: { later: [ymd(addDays(new Date(), -1))] } }));
  const c2 = other.getByRole('region', { name: 'Два питання про застосунок' });
  await c2.getByRole('button', { name: 'Не зараз' }).click();
  await expect(c2).toHaveCount(0);
  await expect(other.getByRole('status')).toContainText('Відповідь збережено.');
  await other.reload(); await other.waitForTimeout(500);
  await expect(c2).toHaveCount(0);
});

test('«Що заважало» → «Надіслати розробникам»: only for a participant, the text seen and fixed first, names replaced (D121)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const calls = pilotCalls(page);
  await page.goto('./#/frictions');
  await page.getByRole('button', { name: 'Шукав кнопку' }).click();
  await page.getByLabel('Кілька слів (необов’язково)').fill('шукав воду, як казала Оксана');
  await page.getByRole('button', { name: 'Записати' }).click();
  await expect(page.getByText('Надсилати можна, якщо берете участь у пілоті («Ще → Пілот»).')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Надіслати розробникам' })).toHaveCount(0);
  await seed(page, participant(2));
  await page.goto('./#/frictions');
  await page.getByRole('button', { name: 'Надіслати розробникам' }).click();
  const box = page.getByLabel(/Ось що піде/);
  await expect(box).toHaveValue('Шукав кнопку — шукав воду, як казала [ім’я]');
  await box.fill('Шукав кнопку води ввечері');
  await page.getByRole('button', { name: 'Надіслати', exact: true }).click();
  await expect(page.getByText('Надіслано розробникам').first()).toBeVisible();
  const note = calls.find((c) => c.body?.includes('"note"'));
  expect(JSON.parse(note!.body!)).toMatchObject({ note: 'Шукав кнопку води ввечері' });
});
