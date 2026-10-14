import { expect, test } from '@playwright/test';
import { device, seed, syncOn, toast } from './helpers';

test('kettlebell library: a card with two poses, an exercise replaced and one added; the next workout keeps the own set (D60)', async ({ browser }) => {
  const page = await device(browser);
  await page.goto('./#/workout');
  await page.getByRole('button', { name: 'Як виконувати: Гоблет-присід' }).click();
  const card = page.getByRole('dialog', { name: 'Гоблет-присід' });
  await expect(card.getByRole('img', { name: 'Початок' })).toBeVisible();
  await expect(card.getByRole('img', { name: 'Рух' })).toBeVisible();
  await expect(card).toContainText('Амплітуда і напрям');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Замінити: Гоблет-присід' }).click();
  await page.getByRole('button', { name: /^Зворотний випад/ }).click();
  await page.getByRole('dialog', { name: /^Зворотний випад/ }).getByRole('button', { name: 'Замінити на цю' }).click();
  await expect(page.getByRole('button', { name: /^Як виконувати: Зворотний випад/ })).toBeVisible();

  await page.getByRole('button', { name: 'Додати вправу' }).click();
  await page.getByRole('button', { name: 'Складний', exact: true }).click();
  await page.getByRole('button', { name: /^Турецький підйом/ }).click();
  await expect(page.getByRole('dialog', { name: 'Турецький підйом' })).toContainText('Освоюйте з тренером');
  await page.getByRole('dialog', { name: 'Турецький підйом' }).getByRole('button', { name: 'Додати в тренування' }).click();
  await expect(page.getByRole('button', { name: /^Як виконувати: Турецький підйом/ })).toBeVisible();

  await page.getByRole('button', { name: 'Записати тренування' }).click();
  await expect(toast(page)).toHaveText(/Тренування записано/);
  await page.getByRole('button', { name: 'Наступний день' }).click();
  await page.getByRole('button', { name: 'Наступний день' }).click();
  await expect(page.getByRole('button', { name: /^Як виконувати: Зворотний випад/ })).toBeVisible(); // the own set, not the programme
  await expect(page.getByRole('button', { name: /^Як виконувати: Турецький підйом/ })).toBeVisible();
});

test('advice from the own records: far beyond the target twice → the next level, offered not imposed (D61)', async ({ browser }) => {
  const page = await device(browser);
  const ago = (n: number) => { const d = new Date(Date.now() - n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const squat = (reps: number[]) => ({ exerciseId: 'goblet-squat', name: 'Гоблет-присід', target: '3 × 10', sets: reps.map((r) => ({ reps: r })) });
  await seed(page, [
    { store: 'workouts', value: { id: 'a', date: ago(4), durationMin: 30, equipment: 'Гиря 16 кг', feeling: 'Нормально', exercises: [squat([15, 15, 16])] } },
    { store: 'workouts', value: { id: 'b', date: ago(2), durationMin: 30, equipment: 'Гиря 16 кг', feeling: 'Легко', exercises: [squat([16, 15, 15])] } },
  ]);
  await page.goto('./#/workout');
  await expect(page.getByText('Минулого разу: 16 · 15 · 15')).toBeVisible();
  await expect(page.getByText(/За 7 днів: тренувань — 2/)).toBeVisible();
  await page.getByRole('button', { name: /^Замінити на «Зворотний випад/ }).click();
  await expect(page.getByRole('button', { name: /^Як виконувати: Зворотний випад/ })).toBeVisible();
});

test('«Скласти тренування з ІІ» (model stubbed): the chosen levels go, the answer is a checked draft with advice, nothing recorded (D63)', async ({ browser }) => {
  const page = await device(browser);
  await syncOn(page);
  let sent: { exercises: { id: string; level: number }[] } | undefined;
  await page.route('**/workout', async (r) => {
    sent = r.request().postDataJSON();
    await r.fulfill({ json: { advice: 'Почніть спокійно — це перше тренування.', exercises: [
      { id: 'goblet-squat', sets: 3, reps: 10, seconds: null }, { id: 'swing', sets: 3, reps: 12, seconds: null },
      { id: 'snatch', sets: 3, reps: 5, seconds: null }, { id: 'plank', sets: 2, reps: null, seconds: 30 }] } });
  });
  await page.goto('./#/workout');
  const panel = page.getByRole('region', { name: 'Скласти тренування з ІІ' });
  await expect(panel.getByRole('button', { name: 'Базовий + середній' })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Скласти тренування' }).click();
  await panel.getByRole('button', { name: 'Дозволити й скласти' }).click(); // consent and compose in one tap
  await expect(page.getByText('Почніть спокійно — це перше тренування.')).toBeVisible();
  expect(sent!.exercises.every((e) => e.level <= 2)).toBe(true);
  await expect(page.getByText(/1 — не з бібліотеки або не того рівня/)).toBeVisible(); // the snatch
  await expect(page.getByRole('button', { name: /^Як виконувати: Махи двома руками/ })).toBeVisible();
  await expect(page.getByText('3 × 12', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Як виконувати: Ривок/ })).toHaveCount(0);
});

test('a reply that comes after moving to another day is dropped — never written over that day (review #1, #2)', async ({ browser }) => {
  const page = await device(browser);
  await syncOn(page);
  await page.route('**/workout', async (r) => {
    await new Promise((ok) => setTimeout(ok, 1500));
    await r.fulfill({ json: { advice: 'Пізня порада', exercises: [{ id: 'swing', sets: 3, reps: 12, seconds: null },
      { id: 'goblet-squat', sets: 3, reps: 10, seconds: null }, { id: 'plank', sets: 2, reps: null, seconds: 30 }] } });
  });
  await page.goto('./#/workout');
  await page.getByRole('region', { name: 'Скласти тренування з ІІ' }).getByRole('button', { name: 'Скласти тренування' }).click();
  await page.getByRole('button', { name: 'Дозволити й скласти' }).click();
  await page.getByRole('button', { name: 'Наступний день' }).click();
  await page.waitForTimeout(2500);
  await expect(page.getByText('Пізня порада')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Як виконувати: Махи двома руками/ })).toHaveCount(0);
});

test('a symptom in the last 24 hours is said before an AI session; «Попросити легше» only fills the wish (D75)', async ({ browser }) => {
  const page = await device(browser);
  await page.evaluate(async () => { // a symptom an hour ago, with the device's own offset
    const d = new Date(Date.now() - 3_600_000), p = (n: number) => String(n).padStart(2, '0'), o = -d.getTimezoneOffset();
    const at = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${o >= 0 ? '+' : '-'}${p(Math.abs(o) / 60 | 0)}:${p(Math.abs(o) % 60)}`;
    const req = indexedDB.open('protocol');
    await new Promise((r) => { req.onsuccess = r; });
    const tx = req.result.transaction('entries', 'readwrite');
    tx.objectStore('entries').put({ id: 's1', at, kind: 'symptom', status: 'done', title: 'Біль у спині', symptoms: ['Біль у спині'] });
    await new Promise((r) => { tx.oncomplete = r; });
    req.result.close();
  });
  await page.goto('./#/workout');
  const panel = page.getByRole('region', { name: 'Скласти тренування з ІІ' });
  await expect(panel.getByText(/За останню добу записано: Біль у спині/)).toBeVisible();
  await panel.getByRole('button', { name: 'Попросити легше' }).click();
  await expect(panel.getByLabel(/Побажання/)).toHaveValue(/легше/);
});
