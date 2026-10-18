import { expect, test, type Page } from '@playwright/test';
import { device, toast } from './helpers';

/** The browser's speech recognition, stubbed: each start() «hears» the next phrase of window.__say (or fails as told). */
async function fakeSpeech(page: Page, say: string[], error?: string) {
  await page.addInitScript(([phrases, err]) => {
    const w = window as unknown as Record<string, unknown>;
    w.__say = phrases;
    w.SpeechRecognition = class {
      lang = ''; interimResults = false; continuous = false; maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          const next = (w.__say as string[]).shift();
          if (err) this.onerror?.({ error: err });
          else if (next) {
            const res = Object.assign([{ transcript: next }], { isFinal: true });
            this.onresult?.({ resultIndex: 0, results: [res] });
          } else this.onerror?.({ error: 'no-speech' });
          this.onend?.();
        }, 50);
      }
      stop() { /* the stub ends by itself */ } abort() { /* — */ }
    };
  }, [say, error ?? ''] as const);
  await page.reload();
}

const meals = (page: Page) => page.evaluate(async () => {
  const req = indexedDB.open('protocol'); await new Promise((r) => { req.onsuccess = r; });
  const all = req.result.transaction('entries').objectStore('entries').getAll(); await new Promise((r) => { all.onsuccess = r; });
  return (all.result as { kind: string; title: string; items?: { name: string }[] }[]).map((e) => `${e.kind}:${e.title}:${(e.items ?? []).map((i) => i.name).join('+')}`);
});

test('the voice window: one phrase → a draft with the plan\'s flags, a command on it, one tap writes — twice never doubles (D95)', async ({ browser }) => {
  const page = await device(browser); // the example plan: lactose, glycemia; vitamin D
  await fakeSpeech(page, ['на сніданок з\'їв два яйця, 60 грамів хліба і кава з молоком і вітамін д випив', 'прибери каву']);
  await page.getByRole('button', { name: 'Сказати голосом' }).click();
  await page.getByRole('button', { name: 'Зрозуміло, говорити' }).click(); // once: who recognises the voice
  const sheet = page.getByRole('dialog', { name: /Скажіть, що з’їли/ });
  await expect(sheet.locator('[data-item]')).toHaveCount(3);
  await expect(sheet.locator('[data-item="Кава з молоком (без цукру)"]')).toContainText('Лактоза'); // the plan's own check
  await expect(sheet).toContainText('Ліки — прийнято: Вітамін D');
  await expect(sheet.getByRole('button', { name: 'Сніданок', pressed: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Сказати ще' }).click();
  await expect(sheet.locator('[data-item]')).toHaveCount(2); // «прибери каву»
  const save = sheet.getByRole('button', { name: 'Записати' });
  await save.dblclick();
  await expect(toast(page)).toContainText('Записано');
  const rows = await meals(page);
  expect(rows.filter((r) => r.startsWith('meal:'))).toEqual(['meal:Сніданок:Яйце варене+Білий хліб (батон)']);
  expect(rows.filter((r) => r.startsWith('med:'))).toHaveLength(1);
  await page.goto('./#/frictions');
  await expect(page.getByText(/Голосом: медіана \d+ с від відкриття до запису \(останні 1\)/)).toBeVisible();
});

test('a quantity nobody said is asked, not assumed; no network — the same words typed work offline (D95)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await fakeSpeech(page, [], 'network');
  await page.goto('./#/do/voice');
  await page.getByRole('button', { name: 'Зрозуміло, говорити' }).click();
  const sheet = page.getByRole('dialog', { name: /Скажіть, що з’їли/ });
  await expect(sheet.getByRole('alert')).toContainText('Немає зв’язку');
  await sheet.getByPlaceholder('два яйця, кава з молоком').fill('гречка і склянка води');
  await sheet.getByRole('button', { name: 'Додати' }).click();
  await expect(sheet).toContainText('Вода — 250 мл');
  await expect(sheet.getByRole('button', { name: 'Записати' })).toBeDisabled(); // the buckwheat's amount is not said
  await sheet.getByRole('group', { name: /Кількість не названо — оберіть: Гречка варена/ }).getByRole('button', { name: '1 порція' }).click();
  await sheet.getByRole('button', { name: 'Записати' }).click();
  await expect(toast(page)).toContainText('Записано');
});

test('a dish said without an amount offers its portions — ½, 1, 1½, 2 (D95)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await fakeSpeech(page, ['на обід гречка з куркою']);
  await page.getByRole('button', { name: 'Сказати голосом' }).click();
  await page.getByRole('button', { name: 'Зрозуміло, говорити' }).click();
  const pick = page.getByRole('group', { name: /Кількість не названо — оберіть: Гречка з куркою/ });
  await expect(pick.getByRole('button')).toHaveText(['0,5 порції', '1 порція', '1,5 порції', '2 порції']);
  await pick.getByRole('button', { name: '1,5 порції' }).click();
  await expect(page.locator('[data-item="Гречка з куркою"]')).toContainText('1,5 порції');
});

test('a line not found is never dropped silently: «Записати» waits until it is matched or taken out (D97, audit P1)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await fakeSpeech(page, ['гречка 200 грамів, бабусин пиріжок і склянка води']);
  await page.getByRole('button', { name: 'Сказати голосом' }).click();
  await page.getByRole('button', { name: 'Зрозуміло, говорити' }).click();
  const sheet = page.getByRole('dialog', { name: /Скажіть, що з’їли/ });
  await expect(sheet).toContainText('«бабусин пиріжок» — не знайдено');
  await expect(sheet).toContainText('Не розібрано: 1');
  await expect(sheet.getByRole('button', { name: 'Записати' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Прибрати', exact: true }).click(); // on purpose
  await expect(sheet.getByRole('button', { name: 'Записати' })).toBeEnabled();
});
