import { expect, test, type Page } from '@playwright/test';
import { device, toast } from './helpers';

/** The browser's speech recognition, stubbed: each start() «hears» the next phrase of window.__say (or fails as told).
 *  `final: false` — like Safari on iPhone: the words come only as interim results and it ends without a final one (D105). */
async function fakeSpeech(page: Page, say: string[], error?: string, final = true, glued = false) {
  await page.addInitScript(([phrases, err, fin, glue]) => {
    const w = window as unknown as Record<string, unknown>;
    w.__say = phrases;
    w.SpeechRecognition = class {
      lang = ''; interimResults = false; continuous = false; maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          const one = (w.__say as string[]).shift();
          // `glued`: the recogniser hands back everything heard so far, glued without a space (D107, the analyst's run)
          const next = one && glue === '1' ? (w.__heard = `${(w.__heard as string | undefined) ?? ''}${one}`) as string : one;
          if (err) this.onerror?.({ error: err });
          else if (next) {
            const res = Object.assign([{ transcript: next }], { isFinal: fin === '1' });
            this.onresult?.({ resultIndex: 0, results: [res] });
          } else this.onerror?.({ error: 'no-speech' });
          this.onend?.();
        }, 50);
      }
      stop() { /* the stub ends by itself */ } abort() { /* — */ }
    };
  }, [say, error ?? '', final ? '1' : '', glued ? '1' : ''] as const);
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
  await page.goto('./#/do/voice'); // D162: the window stays; «Сьогодні» has the one field instead of its button
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
  // Toast appears inside the async save before the local-only timing metric is recorded.
  // Wait for the metric itself so route navigation cannot race its persistence.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('protocol.metrics.voice') ?? '[]').length)).toBe(1);
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
  await page.goto('./#/do/voice'); // D162: the window stays; «Сьогодні» has the one field instead of its button
  await page.getByRole('button', { name: 'Зрозуміло, говорити' }).click();
  const pick = page.getByRole('group', { name: /Кількість не названо — оберіть: Гречка з куркою/ });
  await expect(pick.getByRole('button')).toHaveText(['0,5 порції', '1 порція', '1,5 порції', '2 порції']);
  await pick.getByRole('button', { name: '1,5 порції' }).click();
  await expect(page.locator('[data-item="Гречка з куркою"]')).toContainText('1,5 порції');
});

test('a line not found is never dropped silently: «Записати» waits until it is matched or taken out (D97, audit P1)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await fakeSpeech(page, ['гречка 200 грамів, бабусин пиріжок і склянка води']);
  await page.goto('./#/do/voice'); // D162: the window stays; «Сьогодні» has the one field instead of its button
  await page.getByRole('button', { name: 'Зрозуміло, говорити' }).click();
  const sheet = page.getByRole('dialog', { name: /Скажіть, що з’їли/ });
  await expect(sheet).toContainText('«бабусин пиріжок» — не знайдено');
  await expect(sheet).toContainText('Не розібрано: 1');
  await expect(sheet.getByRole('button', { name: 'Записати' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Прибрати', exact: true }).click(); // on purpose
  await expect(sheet.getByRole('button', { name: 'Записати' })).toBeEnabled();
});

test('dictation as on an iPhone — no commas, «це все», never a final result: the words land in the field, can be corrected, «Записати» writes (D105)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await fakeSpeech(page, ["З'їв 250 г вівсянки 2 варених яйця 1 куряче стегно і салат помідор огірок, це все"], undefined, false);
  await page.goto('./#/do/voice'); // D162: the window stays; «Сьогодні» has the one field instead of its button
  await page.getByRole('button', { name: 'Зрозуміло, говорити' }).click();
  const sheet = page.getByRole('dialog', { name: /Скажіть, що з’їли/ });
  const field = sheet.getByRole('textbox', { name: 'Або напишіть тут' });
  await expect(field).toHaveValue("З'їв 250 г вівсянки 2 варених яйця 1 куряче стегно і салат помідор огірок"); // the stop words are not food
  await expect(sheet.locator('[data-item]')).toHaveCount(4); // read from the field as it is, no commas needed
  await expect(sheet.locator('[data-item="Вівсянка на воді"]')).toContainText('250 г');
  await expect(sheet.getByRole('button', { name: 'Записати' })).toBeDisabled(); // the salad's amount is not said
  await field.fill("З'їв 250 г вівсянки 2 варених яйця 1 куряче стегно"); // corrected by hand: no salad after all
  await expect(sheet.locator('[data-item]')).toHaveCount(3);
  await sheet.getByRole('button', { name: 'Записати' }).click();
  await expect(toast(page)).toContainText('Записано');
  expect((await meals(page)).filter((r) => r.startsWith('meal:')).map((r) => r.split(':')[2])).toEqual(['Вівсянка на воді+Яйце варене+Курячі стегна запечені']); // the meal's name goes by the hour
});

test('commands on the draft: a quantity fixed, a line of what was done with «Скасувати», a part of a dish asked — never a line «не знайдено» (D107)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await fakeSpeech(page, ['гречка з куркою 2 яйця і кава з молоком це все', 'не 2 а 3 яйця', 'видали каву', 'прибери курку']);
  await page.goto('./#/do/voice'); // D162: the window stays; «Сьогодні» has the one field instead of its button
  await page.getByRole('button', { name: 'Зрозуміло, говорити' }).click();
  const sheet = page.getByRole('dialog', { name: /Скажіть, що з’їли/ });
  await expect(sheet.locator('[data-item]')).toHaveCount(3);
  await sheet.getByRole('button', { name: 'Сказати ще' }).click();
  await expect(sheet.locator('[data-item="Яйце варене"]')).toContainText('3 шт');
  await expect(sheet.getByRole('status').filter({ hasText: 'Яйце варене: тепер 3 шт' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Сказати ще' }).click();
  await expect(sheet.locator('[data-item]')).toHaveCount(2);
  await sheet.getByRole('button', { name: 'Скасувати', exact: true }).first().click(); // the coffee comes back
  await expect(sheet.locator('[data-item]')).toHaveCount(3);
  await sheet.getByRole('button', { name: 'Сказати ще' }).click();
  const ask = sheet.getByRole('group', { name: /«курку» — частина страви «Гречка з куркою»/ });
  await ask.getByRole('button', { name: 'Замінити на «Гречка варена»' }).click();
  await expect(sheet.locator('[data-item="Гречка варена"]')).toBeVisible();
  await expect(sheet.locator('[data-item="Гречка з куркою"]')).toHaveCount(0);
  await expect(sheet).not.toContainText('не знайдено');
});

test('a recogniser that glues what was said before to the new words: only the new words reach the field, the command works (D107)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await fakeSpeech(page, ['гречка з куркою 2 яйця кава з молоком це все', 'прибери курку', 'видали каву'], undefined, true, true);
  await page.goto('./#/do/voice'); // D162: the window stays; «Сьогодні» has the one field instead of its button
  await page.getByRole('button', { name: 'Зрозуміло, говорити' }).click();
  const sheet = page.getByRole('dialog', { name: /Скажіть, що з’їли/ });
  await expect(sheet.locator('[data-item]')).toHaveCount(3);
  await sheet.getByRole('button', { name: 'Сказати ще' }).click();
  const field = sheet.getByRole('textbox', { name: 'Або напишіть тут' });
  await expect(field).toHaveValue('прибери курку'); // not «…це всеприбери курку»
  await sheet.getByRole('group', { name: /«курку» — частина страви/ }).getByRole('button', { name: /^Прибрати всю/ }).click();
  await expect(field).toHaveValue('');
  await sheet.getByRole('button', { name: 'Сказати ще' }).click();
  await expect(field).toHaveValue('видали каву'); // not «прибери куркувидали каву»
  await expect(sheet.locator('[data-item]')).toHaveCount(1);
  await expect(sheet).not.toContainText('не знайдено');
});

test('amounts nobody said are not shown as if they were; one tap gives all a usual portion; the espresso is written as itself (D109)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await fakeSpeech(page, ['куряче філе, салат, гречка і еспресо']);
  await page.goto('./#/do/voice'); // D162: the window stays; «Сьогодні» has the one field instead of its button
  await page.getByRole('button', { name: 'Зрозуміло, говорити' }).click();
  const sheet = page.getByRole('dialog', { name: /Скажіть, що з’їли/ });
  await expect(sheet.locator('[data-item]')).toHaveCount(4);
  await expect(sheet.locator('[data-item="Гречка варена"]')).toContainText('скільки — не сказано');
  await expect(sheet.locator('[data-item="Гречка варена"]')).not.toContainText('1 порція ≈');
  await expect(sheet.locator('[data-item="Еспресо"]')).toContainText('1 шт ≈ 30 г');
  await expect(sheet.getByRole('button', { name: 'Записати' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Усім — звичайна порція' }).click();
  await expect(sheet.locator('[data-item="Гречка варена"]')).toContainText('1 порція');
  await sheet.getByRole('button', { name: 'Записати' }).click();
  await expect(toast(page)).toContainText('Записано');
  expect((await meals(page)).filter((r) => r.startsWith('meal:'))[0]).toContain('Еспресо');
});

test('Soniox offered: its own consent even after the phone’s, «Так» starts from that tap; no key — the phone’s engine (D174)', async ({ browser }) => {
  const page = await device(browser, 'example', { sw: false }); // stubbed network: no worker in the way
  const keys: string[] = [];
  await page.route('**/v1/device/speech', (r) => r.fulfill({ json: { available: true, id: 'a1b2c3d4e5f6', engine: 'soniox-test' } }));
  await page.route('**/v1/device/speech/key', (r) => { keys.push(r.request().method()); return r.fulfill({ status: 503, json: { error: 'speech_off' } }); });
  await page.addInitScript(() => {
    localStorage.setItem('protocol.deviceToken', 'dev_e2e'); // a device that already has its token
    localStorage.setItem('protocol.voice.ok', '1'); // the D95 consent was given before Soniox existed
    // a microphone that gives silence (the real one needs a person)
    navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
  });
  await fakeSpeech(page, ['два яйця і кава з молоком']);
  await page.goto('./#/more/settings');
  const voice = page.getByTestId('voice-settings');
  await expect(voice.getByRole('radio', { name: 'Soniox', checked: true })).toBeVisible(); // the switch: only when the server gives a key
  await expect(voice.getByTestId('voice-test-id')).toHaveText('a1b2c3d4e5f6');
  await page.goto('./#/');
  await page.getByRole('button', { name: 'Сказати голосом' }).first().click();
  const consent = page.getByTestId('voice-consent-soniox');
  await expect(consent).toContainText('Soniox'); // a new consent: the D95 «yes» does not carry over
  await expect(consent).toContainText('написати текстом');
  await consent.getByRole('button', { name: 'Так, говорити' }).click();
  await expect.poll(() => keys.length).toBe(1); // the recording started from that tap, without a second one
  await expect(page.getByText(/Яйце/).first()).toBeVisible(); // no key → once to the phone’s engine (D95 given), the words arrive
  expect(await page.evaluate(() => localStorage.getItem('protocol.sonioxConsent'))).toBe('yes');
  // «Телефон»: the server is never asked for a key again
  await page.goto('./#/more/settings');
  await page.getByTestId('voice-settings').getByRole('radio', { name: 'Телефон' }).click();
  await page.goto('./#/');
  await page.evaluate(() => { (window as unknown as { __say: string[] }).__say = ['склянка води']; });
  await page.getByRole('button', { name: 'Сказати голосом' }).first().click();
  await expect(page.getByTestId('voice-consent-soniox')).toHaveCount(0);
  await expect(page.getByText(/250 мл/).first()).toBeVisible();
  expect(keys).toHaveLength(1);
});

test('only the Soniox «yes»: a shortcut never starts the phone’s engine by itself; a failed key — «напишіть текстом», nothing else hears (D174)', async ({ browser }) => {
  const page = await device(browser, 'example', { sw: false });
  const keys: string[] = [];
  await page.route('**/v1/device/speech', (r) => r.fulfill({ json: { available: true, id: 'a1b2c3d4e5f6', engine: 'soniox-test' } }));
  await page.route('**/v1/device/speech/key', (r) => { keys.push(r.request().method()); return r.fulfill({ status: 503, json: { error: 'speech_off' } }); });
  await page.addInitScript(() => {
    localStorage.setItem('protocol.deviceToken', 'dev_e2e');
    localStorage.setItem('protocol.sonioxConsent', 'yes'); // Soniox agreed to; the phone's engine (D95) never was
    navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
  });
  await fakeSpeech(page, ['два яйця']);
  await page.goto('./#/more/settings'); // the server's answer is in before the shortcut
  await expect(page.getByTestId('voice-test-id')).toHaveText('a1b2c3d4e5f6');
  await page.goto('./#/do/voice');
  const sheet = page.getByRole('dialog', { name: /Скажіть, що з’їли/ });
  await expect(sheet.getByRole('button', { name: 'Говорити' })).toBeVisible(); // no consent asked, and not listening
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as { __say: string[] }).__say.length)).toBe(1); // the phone's engine never started
  await sheet.getByRole('button', { name: 'Говорити' }).click();
  await expect.poll(() => keys.length).toBe(1);
  await expect(sheet.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __say: string[] }).__say.length)).toBe(1); // no fallback without D95
  await expect(sheet.locator('[data-item]')).toHaveCount(0);
});

test('#/dev/speech: only with its flag; one phrase read by both engines in a random order, text and times kept, the JSON out (D175)', async ({ browser }) => {
  const page = await device(browser, 'example', { sw: false });
  await page.goto('./#/dev/speech');
  await expect(page.getByText('Сторінку експерименту вимкнено')).toBeVisible(); // no flag — nothing to run
  await page.route('**/v1/device/speech', (r) => r.fulfill({ json: { available: true, id: 'a1b2c3d4e5f6', engine: 'soniox-test' } }));
  await page.route('**/v1/device/speech/key', (r) => r.fulfill({ json: { key: 'snx_temp_e2e', expiresAt: new Date(Date.now() + 60_000).toISOString(), model: 'stt-rt-v6', maxSeconds: 60 } }));
  await page.addInitScript(() => {
    localStorage.setItem('protocol.deviceToken', 'dev_e2e');
    localStorage.setItem('protocol.sonioxConsent', 'yes'); localStorage.setItem('protocol.voice.ok', '1');
    navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
    // Soniox's socket, stubbed: the words after the config, the end after the empty frame
    (window as unknown as { WebSocket: unknown }).WebSocket = class {
      readyState = 0; onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null; onerror = null; onclose: (() => void) | null = null;
      constructor(readonly url: string, readonly protocols: string[]) { setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 30); }
      send(d: unknown) {
        if (typeof d !== 'string') return;
        if (d === '') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ tokens: [], finished: true }) }), 30);
        else setTimeout(() => this.onmessage?.({ data: JSON.stringify({ tokens: [{ text: 'Склянка води. Це все.', is_final: true }] }) }), 60);
      }
      close() { this.readyState = 3; }
    };
  });
  await fakeSpeech(page, ['склянка води']);
  await page.goto('./?speechdev=on#/dev/speech');
  const lab = page.getByTestId('dev-speech');
  await expect(lab.getByText('Фраза 1 з 40')).toBeVisible();
  await lab.getByRole('button', { name: 'Далі' }).click();
  await expect(lab.getByTestId('dev-phrase')).toHaveText('два яйця і кава з молоком, це все');
  for (let i = 0; i < 27; i++) await lab.getByRole('button', { name: 'Далі' }).click(); // to «склянка води»
  await expect(lab.getByTestId('dev-phrase')).toHaveText('склянка води');
  await lab.getByRole('button', { name: 'Запис 1' }).click();
  await expect(lab.getByText(/Запис 1 · Почуто:/)).toBeVisible();
  await lab.getByRole('button', { name: 'Запис 2' }).click();
  await expect(lab.getByText(/Запис 2 · Почуто:/)).toBeVisible();
  await expect(lab.getByTestId('dev-runs')).toHaveText('Записів на цьому телефоні: 2');
  const [file] = await Promise.all([page.waitForEvent('download'), lab.getByRole('button', { name: 'Вивантажити JSON' }).click()]);
  const out = JSON.parse(await (await file.createReadStream()).toArray().then((b) => Buffer.concat(b).toString('utf8'))) as { runs: Record<string, unknown>[] };
  expect(out.runs.map((r) => r.engine).sort()).toEqual(['browser', 'soniox']);
  for (const r of out.runs) {
    expect(r.phrase).toBe('water-glass');
    expect(String(r.text).toLowerCase()).toContain('склянка води');
    expect(Object.keys(r).sort()).toEqual(expect.arrayContaining(['startedAt', 'endedAt', 'text', 'engine', 'platform', 'speaker', 'condition']));
    expect(Object.keys(r).some((k) => /audio|sound|key/i.test(k))).toBe(false); // text and times only
  }
  expect(out.runs.find((r) => r.engine === 'soniox')!.socketMs).toBeGreaterThan(0);
});
