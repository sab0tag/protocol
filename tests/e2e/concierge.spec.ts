import { expect, test } from '@playwright/test';
import { device, seed, syncOn, toast } from './helpers';

test('scenario 1 (model stubbed): only names of the base, nothing written without a tap, the outcome told on save — edited, with what (D91)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await syncOn(page);
  const sent: { body: Record<string, unknown> }[] = [], outcomes: Record<string, unknown>[] = [];
  await page.route('**/concierge/not-found', async (r) => { sent.push({ body: r.request().postDataJSON() }); await r.fulfill({ json: { candidates: ['Вареники з картоплею', 'Млинці'], id: 'c-2026-10-18-abc123' } }); });
  await page.route('**/concierge/outcome', async (r) => { outcomes.push(r.request().postDataJSON()); await r.fulfill({ json: { ok: true } }); });
  await page.goto('./#/meal/new');
  await page.getByPlaceholder('Напр.: 2 яйця, кава').fill('бабусин пиріжок');
  await expect(page.getByText('«бабусин пиріжок» — не знайдено — додайте вручну')).toBeVisible();
  await page.getByRole('button', { name: 'Запитати ІІ, на що схоже' }).click();
  await page.getByRole('checkbox', { name: /Записувати ці звернення/ }).check(); // the log: a consent of its own, off by default
  await page.getByRole('button', { name: 'Дозволити й запитати' }).click();
  const like = page.getByRole('group', { name: 'Схоже на' });
  await expect(like.locator('[data-item]')).toHaveCount(2);
  expect(sent[0]!.body).toMatchObject({ text: 'бабусин пиріжок', log: true });
  expect((sent[0]!.body.names as string[]).length).toBeGreaterThan(200); // the base's own names go, nothing of the person's
  expect(await page.evaluate(async () => {
    const req = indexedDB.open('protocol'); await new Promise((r) => { req.onsuccess = r; });
    const c = req.result.transaction('entries').objectStore('entries').count(); await new Promise((r) => { c.onsuccess = r; }); return c.result;
  })).toBe(0); // offered, not written
  await like.locator('[data-item="Вареники з картоплею"]').click();
  await expect(page.getByText('Вареники з картоплею')).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Кількість' }).first().fill('8'); // 8 pieces instead of a portion
  await page.getByRole('button', { name: 'Записати', exact: true }).click();
  await expect(toast(page)).toContainText('записано');
  await expect.poll(() => outcomes.length).toBe(1);
  expect(outcomes[0]).toMatchObject({ id: 'c-2026-10-18-abc123', outcome: 'edited', edit: { field: 'grams' } });
});

test('a danger sign in the words — the 103 card, no model; «Чому?» answers from the plan itself (D91)', async ({ browser }) => {
  const page = await device(browser); // the example plan: lactose, glycemia, oxalates
  let asked = false;
  await page.route('**/concierge/**', async (r) => { asked = true; await r.abort(); });
  await page.goto('./#/meal/new');
  await page.getByPlaceholder('Напр.: 2 яйця, кава').fill('після горіхів набряк губ');
  await expect(page.getByRole('link', { name: 'Подзвонити 103' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Запитати ІІ, на що схоже' })).toHaveCount(0);
  expect(asked).toBe(false);

  await page.getByPlaceholder('Напр.: 2 яйця, кава').fill('кава з молоком');
  await page.locator('ul button[data-item]').first().click();
  const check = page.locator('section[aria-live]', { hasText: 'Перевірка за планом лікаря' });
  await check.getByRole('button', { name: 'Чому?' }).first().click();
  await expect(check).toContainText('У вашому плані: «Непереносимість лактози» — Кефір і витримані сири — так, молоко — ні. (Приклад).');
  await expect(check.getByRole('link', { name: 'Відкрити в плані' })).toBeVisible();
});

test('«Журнал помічника»: off by default, the own records with what was done, deleted in one tap (D91)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await syncOn(page);
  let deleted = false;
  await page.route('**/concierge/log', async (r) => {
    if (r.request().method() === 'DELETE') { deleted = true; await r.fulfill({ json: { deleted: 1 } }); return; }
    await r.fulfill({ json: deleted ? [] : [{ id: 'c-1', ts: '2026-10-18T13:20:05.000Z', scenario: 'not_found', input: 'бабусин пиріжок', output: { items: [{ name: 'Млинці' }] }, outcome: 'edited' }] });
  });
  await page.goto('./#/more');
  await page.getByRole('link', { name: 'Журнал помічника (ІІ)' }).click();
  await expect(page.getByRole('checkbox', { name: 'Записувати звернення до помічника' })).not.toBeChecked();
  await expect(page.getByText('«бабусин пиріжок»')).toBeVisible();
  await expect(page.getByText(/Млинці · виправлено/)).toBeVisible();
  await page.getByRole('button', { name: 'Видалити мій журнал' }).click();
  await expect(page.getByText('Записів немає.')).toBeVisible();
});

test('scenarios 3–4 on «День»: the numbers of the day, options that pass the plan, a tap plans — not eats; «Не сьогодні» hides it for the day (D92)', async ({ browser }) => {
  const page = await device(browser); // the example plan: protein 140 g, calcium 1000 mg, carbs up to 190 g, last meal by 20:00
  await page.clock.setFixedTime(new Date('2026-10-18T18:00:00+03:00'));
  const meal = (id: string, time: string, grams: number) => ({ store: 'entries', value: { id, at: `2026-10-18T${time}:00+03:00`, kind: 'meal', status: 'done', title: 'Обід',
    items: [{ foodId: 'buckwheat-boiled', name: 'Гречка варена', grams }] } });
  await seed(page, [meal('m1', '08:00', 200), meal('m2', '13:00', 300)]);
  const card = page.getByRole('region', { name: 'Підказки на вечір' });
  await expect(card).toContainText(/У записах поки: калорій \d+ з 2100 ккал\..*Добрати до вечора\?/); // D116: calories too
  await expect(card).toContainText(/У записах поки: білка \d+ з 140 г\..*Добрати до вечора\?/);
  await expect(card).toContainText(/У записах поки: кальцію \d+ з 1000 мг/);
  await card.locator('[data-item]').first().click();
  await expect(toast(page)).toContainText('у плані на вечір');
  await expect(card).not.toContainText('калорій');
  await card.getByRole('button', { name: 'Не сьогодні' }).first().click();
  await expect(card).not.toContainText('білка');
  await card.getByRole('button', { name: 'Не сьогодні' }).first().click();
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const req = indexedDB.open('protocol'); await new Promise((r) => { req.onsuccess = r; });
    const all = req.result.transaction('entries').objectStore('entries').getAll(); await new Promise((r) => { all.onsuccess = r; });
    return (all.result as { status: string; title: string }[]).filter((e) => e.title === 'Перекус').map((e) => e.status);
  })).toEqual(['planned']); // planned for the evening, not eaten
});
