import { expect, test } from '@playwright/test';
import { device, toast } from './helpers';

test('empty assistant suggestions stay beside the daily context instead of leaving a blank chat area', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/assistant');
  const context = page.locator('section > p.protocol-card');
  const suggestion = page.getByRole('button', { name: 'Що добрати до вечора?' });
  await expect(context).toBeVisible();
  await expect(suggestion).toBeVisible();
  const contextBox = await context.boundingBox();
  const suggestionBox = await suggestion.boundingBox();
  expect(suggestionBox!.y - (contextBox!.y + contextBox!.height)).toBeLessThan(120);
  const composerBox = await page.locator('form').boundingBox();
  const navigationBox = await page.getByRole('navigation', { name: 'Розділи' }).boundingBox();
  expect(navigationBox!.y - (composerBox!.y + composerBox!.height)).toBeLessThan(48);
});

test('the assistant: the code answers «що добрати», the model the rest — a food failing the plan is never shown, medicines get the app’s words, a danger sign the 103 card (D117)', async ({ browser }) => {
  const page = await device(browser); // the example plan: lactose, glycemia, oxalate; Вітамін D; no sync — the device token
  let calls = 0, sent: { text: string; names: string[]; context: { day: { kcal: number } } } | undefined;
  await page.route('**/concierge/chat', async (r) => {
    calls++; sent = r.request().postDataJSON();
    const medicine = /метформін/iu.test(sent!.text);
    await r.fulfill({ json: medicine ? { topic: 'medicine', text: 'Пийте як хочете.', items: [] }
      : { topic: 'food', text: 'З того, що є, вийде вечеря: гречка з яйцем.', items: [{ name: 'Яйце варене', grams: 110 }, { name: 'Молоко 2,5 %', grams: 200 }, { name: 'Гречка варена', grams: 150 }] } });
  });
  await page.goto('./#/');
  await page.getByRole('link', { name: 'Помічник — запитати, що з’їсти' }).click();
  await expect(page.getByRole('heading', { name: 'Помічник' })).toBeVisible();
  await expect(page.getByText(/Сьогодні: калорій 0 з 2100 ккал/)).toBeVisible(); // the code's numbers

  await page.getByRole('button', { name: 'Що добрати до вечора?' }).click(); // the code answers — no model
  await expect(page.getByText('Сьогодні ще нічого не записано')).toBeVisible();
  expect(calls).toBe(0);

  const input = page.getByRole('textbox', { name: 'Питання помічнику' });
  await input.fill('у мене вдома лише яйця і гречка');
  await page.getByRole('button', { name: 'Надіслати' }).click();
  await page.getByRole('button', { name: 'Дозволити й запитати' }).click(); // once
  await expect(page.getByText('З того, що є, вийде вечеря')).toBeVisible();
  expect(sent?.names).toContain('Гречка варена');
  await expect(page.locator('[data-suggestion]')).toHaveCount(2);
  await expect(page.locator('[data-suggestion="Молоко 2,5 %"]')).toHaveCount(0); // lactose in the plan — never offered
  await expect(page.locator('[data-suggestion="Яйце варене"]')).toContainText(/≈ \d+ ккал · білка \d+ г/); // counted by the code
  await page.locator('[data-suggestion="Яйце варене"]').getByRole('button', { name: 'У план на вечір' }).click();
  await expect(toast(page)).toContainText('Яйце варене — у плані на вечір');

  await input.fill('чи можна пити метформін з кавою?');
  await page.getByRole('button', { name: 'Надіслати' }).click();
  await expect(page.getByText(/Про ліки — дозу, пропуск.*запитайте лікаря або фармацевта/)).toBeVisible();
  await expect(page.getByText('Пийте як хочете.')).toHaveCount(0); // the model's words on medicines are never shown

  const before = calls;
  await input.fill('дуже болить у грудях');
  await page.getByRole('button', { name: 'Надіслати' }).click();
  await expect(page.getByText(/103/).first()).toBeVisible();
  expect(calls).toBe(before); // a danger sign never reaches the model
});

test('the assistant at its hardest (D130): despair gets the crisis card, a pressing chest the 103 card — no model, the talk cleared; a model saying «call now» is never softened; «Нова розмова»', async ({ browser }) => {
  const page = await device(browser);
  const asked: { text: string; history: { text: string }[] }[] = [];
  await page.context().route('**/concierge/chat', async (r) => {
    const b = r.request().postDataJSON() as { text: string; history: { text: string }[] };
    asked.push(b);
    await r.fulfill({ json: /погано/iu.test(b.text) ? { topic: 'symptoms', text: 'Якщо біль сильна — негайно телефонуйте 103.', items: [] }
      : { topic: 'food', text: 'На вечерю — гречка з яйцем.', items: [] } });
  });
  await page.goto('./#/assistant');
  const input = page.getByRole('textbox', { name: 'Питання помічнику' });
  const send = async (q: string) => { await input.fill(q); await page.getByRole('button', { name: 'Надіслати' }).click(); };
  await send('можна мені шаурму на вечерю?');
  await page.getByRole('button', { name: 'Дозволити й запитати' }).click();
  await expect(page.getByText('На вечерю — гречка з яйцем.')).toBeVisible();

  await send('набридло все, не хочу більше жити');
  const crisis = page.locator('[data-card="crisis"]');
  await expect(crisis).toContainText('Lifeline Ukraine 7333');
  await expect(crisis.getByRole('link', { name: 'Подзвонити 7333' })).toHaveAttribute('href', 'tel:7333');
  await expect(crisis.getByRole('link', { name: 'Подзвонити 112' })).toHaveAttribute('href', 'tel:112');
  await expect(page.getByText('набридло все, не хочу більше жити')).toHaveCount(0); // the talk cleared — the words are not kept
  await expect(page.getByText('На вечерю — гречка з яйцем.')).toHaveCount(0);

  await send("після вечері тисне в грудях і віддає в ліву руку, що з'їсти щоб минуло?");
  await expect(page.getByRole('alert')).toContainText('103');
  expect(asked).toHaveLength(1); // neither went to the model

  await send('щось погано після обіду'); // the model says «call now» — the 103 card, not «запишіть у звіт»
  await expect(page.getByRole('alert')).toContainText('103');
  await expect(page.getByText(/запишіть, і це буде у звіті/)).toHaveCount(0);
  await send('а що на вечерю?');
  expect(asked.at(-1)!.history.map((h) => h.text).join(' ')).not.toMatch(/погано|грудях|жити/); // what came before a card never goes again
  await page.getByRole('button', { name: 'Нова розмова' }).click();
  await expect(page.locator('ul[aria-label="Помічник"] > li')).toHaveCount(0);
});

test('a talk kept from before D130 is cleaned on opening: its words of danger or despair are not shown and never sent (D132)', async ({ browser }) => {
  const page = await device(browser);
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ at: Date.now(), v: [
    { id: '1', role: 'user', text: 'набридло все, не хочу більше жити' },
    { id: '2', role: 'assistant', text: 'Що означають самопочуття, симптоми чи аналізи, скаже лікар.' },
    { id: '3', role: 'user', text: 'тисне в грудях' },
    { id: '4', role: 'user', text: 'що на вечерю краще?' }] })), `protocol.kept.assistant:${today}`);
  let sent: { history: { text: string }[] } | undefined;
  await page.context().route('**/concierge/chat', async (r) => { sent = r.request().postDataJSON(); await r.fulfill({ json: { topic: 'food', text: 'Гречка з яйцем.', items: [] } }); });
  await page.goto('./#/assistant');
  await expect(page.getByText('що на вечерю краще?')).toBeVisible();
  await expect(page.getByText(/не хочу більше жити|тисне в грудях/)).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Питання помічнику' }).fill('Можно мне шаурму на ужин?');
  await page.getByRole('button', { name: 'Надіслати' }).click();
  await page.getByRole('button', { name: 'Дозволити й запитати' }).click();
  await expect(page.getByText('Гречка з яйцем.')).toBeVisible();
  expect(JSON.stringify(sent!.history)).not.toMatch(/жити|грудях/);
});
