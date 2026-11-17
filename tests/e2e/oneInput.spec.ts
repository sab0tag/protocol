import { expect, test, type Page } from '@playwright/test';
import { device, seed, toast } from './helpers';

// D162: «Скажіть або напишіть…» on «Сьогодні» — the code decides; nothing is written by itself except water; a medicine only
// after «Так»; danger words show their card; a question with the assistant off never leaves the phone.

const field = (page: Page) => page.getByTestId('one-input').getByRole('textbox', { name: 'Скажіть або напишіть…' });
const say = async (page: Page, text: string) => { await field(page).fill(text); await field(page).press('Enter'); };
const rows = (page: Page) => page.evaluate(async () => {
  const r = indexedDB.open('protocol'); await new Promise((ok) => { r.onsuccess = ok; });
  const all = r.result.transaction('entries').objectStore('entries').getAll();
  const out = await new Promise<{ kind: string; status: string; title: string; waterMl?: number; checkKey?: string; items?: { name: string }[] }[]>((ok) => { all.onsuccess = () => ok(all.result); });
  r.result.close(); return out;
});
/** Requests to the API server (the e2e API is on :8099; the app's own files are not counted). */
const apiCalls = (page: Page) => { const seen: string[] = []; page.on('request', (r) => { if (new URL(r.url()).port === '8099') seen.push(r.url()); }); return seen; };

test('water is written at once with «Скасувати»; «скасуй останнє» takes it back', async ({ browser }) => {
  const page = await device(browser);
  await say(page, 'склянка води');
  await expect(toast(page)).toContainText('+250 мл води');
  expect((await rows(page)).filter((e) => e.kind === 'water').map((e) => e.waterMl)).toEqual([250]);
  await say(page, 'скасуй останнє');
  await expect.poll(async () => (await rows(page)).filter((e) => e.kind === 'water').length).toBe(0);
});

test('a medicine is marked only after «Так»', async ({ browser }) => {
  const page = await device(browser);
  await say(page, 'випив вітамін д');
  const card = page.getByRole('group', { name: /^Відмітити: Вітамін D/ });
  await expect(card).toBeVisible();
  expect((await rows(page)).filter((e) => e.kind === 'med')).toEqual([]);
  await card.getByRole('button', { name: 'Ні' }).click();
  await expect(card).toHaveCount(0);
  expect((await rows(page)).filter((e) => e.kind === 'med')).toEqual([]);
  await say(page, 'випив вітамін д');
  await page.getByRole('group', { name: /^Відмітити: Вітамін D/ }).getByRole('button', { name: 'Так' }).click();
  await expect.poll(async () => (await rows(page)).filter((e) => e.kind === 'med' && e.status === 'done').map((e) => e.title)).toEqual(['Вітамін D']);
});

test('food is a card written with «Записати» into the meal going on now', async ({ browser }) => {
  const page = await device(browser);
  await say(page, 'гречка і кава, це все');
  const card = page.getByRole('group', { name: /^Їжа → / });
  await expect(card).toContainText('Гречка');
  expect((await rows(page)).filter((e) => e.kind === 'meal')).toEqual([]);
  await card.getByRole('button', { name: 'Записати' }).click();
  await expect.poll(async () => (await rows(page)).filter((e) => e.kind === 'meal').flatMap((e) => e.items ?? []).length).toBe(2);
  await expect(page.getByTestId('meal-tiles')).toContainText('Гречка');
});

test('danger and crisis words: their card, and nothing goes to the server', async ({ browser }) => {
  const page = await device(browser);
  const calls = apiCalls(page);
  await say(page, 'з’їв креветки, важко дихати');
  await expect(page.getByRole('link', { name: /103/ })).toBeVisible();
  await say(page, 'набридло все, не хочу більше жити');
  await expect(page.getByRole('link', { name: /7333/ })).toBeVisible();
  expect(calls).toEqual([]);
  expect((await rows(page)).length).toBe(0);
});

test('a question with the assistant off never leaves the phone; with it on, it is handed to «Помічник» unsent', async ({ browser }) => {
  test.skip(process.env.VITE_MODULE_POLICY_ENABLED !== 'true', 'modules switch only in the acceptance build');
  const page = await device(browser);
  const calls = apiCalls(page);
  await seed(page, [{ store: 'moduleEvents', value: { id: 'e2e-assistant-off', v: 1, at: new Date().toISOString(), kind: 'module', module: 'assistant', enabled: false, source: 'manual' } }]);
  await say(page, 'можна мені банан?');
  await expect(page.getByText(/Помічник вимкнений/)).toBeVisible();
  await page.waitForTimeout(500);
  expect(calls).toEqual([]);
  await seed(page, [{ store: 'moduleEvents', value: { id: 'e2e-assistant-on', v: 1, at: new Date(Date.now() + 1000).toISOString(), kind: 'module', module: 'assistant', enabled: true, source: 'manual' } }]);
  await say(page, 'можна мені банан?');
  await page.getByRole('button', { name: 'Запитати Помічника' }).click();
  await expect(page).toHaveURL(/#\/assistant/);
  await expect(page.locator('main input').first()).toHaveValue('можна мені банан?');
  expect(calls.filter((u) => /chat|concierge/.test(u))).toEqual([]);
});
