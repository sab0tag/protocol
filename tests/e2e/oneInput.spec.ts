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
/** Requests that leave the app's own origin — the API server, a model (the app's own files are not counted). */
const apiCalls = (page: Page) => { const seen: string[] = []; page.on('request', (r) => { if (new URL(r.url()).origin !== new URL(page.url()).origin) seen.push(r.url()); }); return seen; };

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

test('food said in the field opens the current meal tile with a draft, written only with «Додати все»; «прибери …» edits it', async ({ browser }) => {
  const page = await device(browser);
  await say(page, 'гречка, яйце і кава, це все');
  const tiles = page.getByTestId('meal-tiles');
  await expect(tiles.getByText('Розпізнано')).toBeVisible();
  await expect(tiles).toContainText('Гречка');
  expect((await rows(page)).filter((e) => e.kind === 'meal')).toEqual([]);
  await say(page, 'прибери каву');
  await expect(tiles.getByText('Розпізнано')).toBeVisible();
  await expect(tiles.locator('label[data-item]')).toHaveCount(2);
  await tiles.getByRole('button', { name: /Додати все/ }).click();
  await expect.poll(async () => (await rows(page)).filter((e) => e.kind === 'meal').flatMap((e) => e.items ?? []).map((i) => i.name).length).toBe(2);
  await expect(tiles.getByText('Розпізнано')).toHaveCount(0);
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

test('a question with the assistant off never leaves the phone', async ({ browser }) => {
  test.skip(process.env.VITE_MODULE_POLICY_ENABLED !== 'true', 'modules switch only in the acceptance build');
  const page = await device(browser);
  const calls = apiCalls(page);
  await seed(page, [{ store: 'moduleEvents', value: { id: 'e2e-assistant-off', v: 1, at: new Date().toISOString(), kind: 'module', module: 'assistant', enabled: false, source: 'manual' } }]);
  await say(page, 'можна мені банан?');
  await expect(page.getByText(/Помічник вимкнений/)).toBeVisible();
  await page.waitForTimeout(500);
  expect(calls).toEqual([]);
});

test('the D166 flag off (production): a question is handed to «Помічник» unsent, as in D162; nothing goes to the server', async ({ browser }) => {
  const page = await device(browser, 'example', { sw: false });
  const calls: string[] = [];
  page.on('request', (r) => { if (/concierge/.test(r.url())) calls.push(r.url()); });
  await page.goto('./?answers=off#/');
  await say(page, 'що приготувати на вечерю?');
  await expect(page.getByRole('group', { name: 'Відповідь Помічника' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Запитати Помічника', exact: true }).click();
  await expect(page).toHaveURL(/#\/assistant$/);
  await expect(page.getByRole('textbox').first()).toHaveValue('що приготувати на вечерю?');
  expect(calls).toEqual([]);
  await page.context().close();
});

test('a question is answered in the field (D166): consent once, suggestions checked by the plan, one to the evening; the talk is on «Помічник»; a «call now» is the 103 card', async ({ browser }) => {
  const page = await device(browser, 'example', { sw: false }); // the example plan: lactose in the limits
  let calls = 0;
  await page.route('**/concierge/chat', async (r) => {
    calls++;
    const b = r.request().postDataJSON() as { text: string };
    await r.fulfill({ json: /погано/iu.test(b.text) ? { topic: 'symptoms', text: 'Якщо біль сильна — негайно телефонуйте 103.', items: [] }
      : { topic: 'food', text: 'З того, що є, вийде вечеря: гречка з яйцем.', items: [{ name: 'Яйце варене', grams: 110 }, { name: 'Молоко 2,5 %', grams: 200 }, { name: 'Гречка варена', grams: 150 }] } });
  });
  await page.goto('./?answers=on#/'); // D166 is behind a flag, off in production; one device turns it on
  const answer = page.getByRole('group', { name: 'Відповідь Помічника' });

  await say(page, 'що добрати до вечора?'); // the code answers — no model
  await expect(answer).toContainText('Сьогодні ще нічого не записано');
  expect(calls).toBe(0);

  await say(page, 'у мене вдома лише яйця і гречка — що приготувати?');
  await answer.getByRole('button', { name: 'Дозволити й запитати' }).click(); // once
  await expect(answer).toContainText('З того, що є, вийде вечеря');
  await expect(answer.locator('[data-suggestion]')).toHaveCount(2);
  await expect(answer.locator('[data-suggestion="Молоко 2,5 %"]')).toHaveCount(0); // lactose in the plan — never offered
  await answer.locator('[data-suggestion="Яйце варене"]').getByRole('button', { name: 'У план на вечір' }).click();
  await expect(toast(page)).toContainText('Яйце варене — у плані на вечір');
  await expect(answer).toHaveCount(0); // the card goes; the snack is in the day's list
  expect((await rows(page)).filter((e) => e.status === 'planned' && e.items?.[0]?.name === 'Яйце варене')).toHaveLength(1);

  const before = calls;
  await say(page, 'що робити, якщо щось погано після обіду?');
  await expect(page.getByRole('link', { name: /103/ })).toBeVisible(); // the model said to call now — never softened
  expect(calls).toBe(before + 1);
  await expect(page.getByText('Якщо біль сильна')).toHaveCount(0);

  await say(page, 'що з’їсти на сніданок, якщо вдома лише гречка?');
  await expect(answer).toContainText('З того, що є'); // no second consent
  await answer.getByRole('link', { name: 'Уся розмова — у «Помічнику»' }).click();
  await expect(page).toHaveURL(/#\/assistant/);
  await expect(page.getByText('що з’їсти на сніданок, якщо вдома лише гречка?')).toBeVisible(); // the talk after the 103 card
  await expect(page.getByText('що робити, якщо щось погано після обіду?')).toHaveCount(0); // D130: never kept
});
