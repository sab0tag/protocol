import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Browser, type Page } from '@playwright/test';

// «ТЗ: демо клиники и тренировки», step 2 (D171): patient А end to end — the doctor signs in with MFA, writes the plan
// (Метформін, стіл №5, a test and the visit), issues a code; a clean phone takes it, checks it against the paper, and lives
// by it; the doctor sees only «отримано»; a week later the report, sent by consent, shows the missed dose. And the refusals:
// the same code again, an expired one, a revoked one, «Не зараз», no network. Two browser contexts — the doctor and the patient.
const API = 'http://localhost:8099';
const DAY = 86_400_000;

async function doctorSignsIn(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('./#/clinic');
  await expect(page.getByRole('heading', { name: 'Кабінет клініки', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Увійти через захищений сервіс' }).click();
  await page.getByRole('button', { name: 'Continue as Doctor', exact: true }).click(); // the synthetic provider: pwd + mfa
  await expect(page).toHaveURL(/#\/clinic$/);
  await expect(page.getByLabel('Назва плану')).toBeVisible();
  return page;
}

async function issue(doctor: Page, title: string): Promise<{ code: string; deliveryId: string }> {
  await doctor.getByLabel('Назва плану').fill(title);
  await doctor.getByLabel(/^Ліки /).fill('Метформін | 500 мг | 2 рази на день | 30 днів | під час їжі');
  await doctor.getByLabel(/^Обмеження/).fill('Стіл №5\nБез солодких напоїв');
  await doctor.getByLabel(/^Аналізи/).fill('Глюкоза натщесерце');
  await doctor.getByLabel('Наступний візит').fill('Огляд ендокринолога через 3 місяці');
  await doctor.getByRole('checkbox', { name: 'Пацієнт погодився отримати цей план у застосунок.' }).check();
  const response = doctor.waitForResponse((r) => r.url().endsWith('/v1/clinic/plans') && r.request().method() === 'POST');
  await doctor.getByRole('button', { name: 'Створити QR', exact: true }).click();
  const issued = await (await response).json() as { deliveryId: string; code: string };
  await expect(doctor.getByText(/Код одноразовий і діє до/)).toBeVisible(); // the code's life is shown
  await expect(doctor.getByRole('status').filter({ hasText: 'Статус: очікує' })).toBeVisible();
  return issued;
}

async function cleanPhone(browser: Browser, at: Date): Promise<Page> {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Kyiv' });
  const page = await ctx.newPage();
  await page.clock.install({ time: at });
  return page;
}

async function plan(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('protocol'); await new Promise((r) => { open.onsuccess = r; });
    const get = open.result.transaction('plan').objectStore('plan').get('main'); await new Promise((r) => { get.onsuccess = r; });
    open.result.close(); return get.result as { prescriptions: { title: string }[]; constraints: { tag: string; title: string }[] } | undefined;
  });
}

const kyiv = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+02:00`);

test('patient А: doctor → code → a clean phone → the plan lived by → the report with the missed dose', async ({ browser }) => {
  const doctor = await doctorSignsIn(browser);
  const calls: string[] = [];
  doctor.on('request', (r) => { if (r.url().startsWith(API)) calls.push(new URL(r.url()).pathname); });
  const { code, deliveryId } = await issue(doctor, 'Цукор: план ендокринолога');

  // 4–5. A clean phone: the code, the plan's preview with the clinic's name, «звірив(ла)», the plan is the person's
  const day1 = '2026-11-16';
  const patient = await cleanPhone(browser, kyiv(day1, '07:50'));
  await patient.goto(`./#/plan/import?code=${code}`);
  await expect(patient.getByRole('heading', { name: 'Клініка надіслала вам план', level: 1 })).toBeVisible();
  const started = Date.now();
  await patient.getByRole('button', { name: 'Переглянути план', exact: true }).click();
  await expect(patient.getByRole('heading', { name: /^«.+» надіслала вам план$/, level: 1 })).toBeVisible();
  for (const line of ['Метформін', 'Стіл №5', 'Без солодких напоїв', 'Глюкоза натщесерце', 'Огляд ендокринолога через 3 місяці'])
    await expect(patient.getByText(line, { exact: false }).first()).toBeVisible();
  const add = patient.getByRole('button', { name: 'Додати до мого плану', exact: true });
  await expect(add).toBeDisabled(); // nothing becomes the plan before «звірив(ла)»
  expect(await plan(patient)).toMatchObject({ prescriptions: [] });
  await patient.getByRole('checkbox', { name: 'Я звірив(ла) кожен пункт із призначенням лікаря' }).check();
  await add.click();
  await expect(patient).toHaveURL(/#\/plan\/prescriptions$/); // no patient «Знайомство» on the way
  const own = await plan(patient);
  expect(own!.prescriptions.map((p) => p.title)).toContain('Метформін');
  expect(own!.constraints.map((c) => c.tag)).toContain('diet'); // «Стіл №5» is a diet of the plan, not a note
  // the person's own times (D157: nothing is read from the free text)
  await patient.getByRole('button', { name: 'Редагувати: Метформін' }).click();
  await patient.getByLabel('Доза (зі слів лікаря)').fill('500 мг');
  await patient.getByLabel('Час прийому (через кому, 08:30, 20:00)').fill('08:00, 20:00');
  await patient.getByRole('button', { name: 'Зберегти', exact: true }).click();
  expect(Date.now() - started, 'from the code to an active plan').toBeLessThan(3 * 60_000);

  // 6. The doctor sees «отримано» — and only that: nothing of the patient's diary comes to the clinic's screen
  await doctor.getByRole('button', { name: 'Оновити статус', exact: true }).click();
  await expect(doctor.getByRole('status').filter({ hasText: 'Статус: отримано' })).toBeVisible();
  expect(calls.filter((p) => p.startsWith('/v1/vaults') || p.startsWith('/v1/device'))).toEqual([]);
  const status = await doctor.request.get(`${API}/v1/clinic/plans/${deliveryId}`);
  expect(Object.keys(await status.json()).sort()).toEqual(['status']);

  // 7. The day: the morning dose marked, the evening one not — on purpose
  await patient.clock.setFixedTime(kyiv(day1, '08:10'));
  await patient.goto('./#/'); await patient.reload();
  const now = patient.locator('.protocol-now-card');
  await expect(now).toContainText('Метформін');
  await now.getByRole('button', { name: 'Відмітити', exact: true }).click();
  await expect(patient.getByRole('navigation', { name: 'Швидкі відмітки', exact: true }).getByRole('button', { name: /^Ліки:/ })).toHaveAccessibleName('Ліки: 1 з 2');
  await patient.clock.setFixedTime(kyiv(day1, '22:30'));
  await patient.reload();
  await expect(patient.getByRole('navigation', { name: 'Швидкі відмітки', exact: true }).getByRole('button', { name: /^Ліки:/ })).toHaveAccessibleName('Ліки: 1 з 2');

  // 8. A week later: «Звіт для лікаря», what goes is listed, the consent, «Поділитися» — the missed dose is in it
  await patient.clock.setFixedTime(new Date(kyiv(day1, '12:00').getTime() + 7 * DAY));
  await patient.evaluate(() => { (navigator as Navigator & { share?: unknown }).share = async (d: { text: string }) => { (window as unknown as { shared: string }).shared = d.text; }; });
  await patient.goto('./#/report'); await patient.reload();
  await patient.evaluate(() => { (navigator as Navigator & { share?: unknown }).share = async (d: { text: string }) => { (window as unknown as { shared: string }).shared = d.text; }; });
  await patient.getByRole('button', { name: 'Поділитися' }).click();
  const consent = patient.getByRole('region', { name: 'Підтвердження передачі' });
  await expect(consent).toContainText('Що буде передано');
  const send = consent.getByRole('button', { name: 'Передати звіт' });
  await expect(send).toBeDisabled();
  await consent.getByRole('checkbox', { name: 'Я погоджуюсь передати ці дані своєму лікарю' }).check();
  await send.click();
  const shared = await patient.evaluate(() => (window as unknown as { shared?: string }).shared ?? '');
  expect(shared).toMatch(/1 з 2/); // one of the two due doses — the missed one is there
  expect(shared).toContain('Метформін');

  // 9. Refusals on the same phone: the same code again; no network — the plan stays as it is
  await patient.goto(`./#/plan/import?code=${code}`);
  await patient.getByRole('button', { name: 'Переглянути план', exact: true }).click();
  await expect(patient.getByRole('alert')).toHaveText('Цей код уже використано. Попросіть клініку видати новий.');
  await doctor.getByRole('button', { name: 'Новий план', exact: true }).click();
  const second = await issue(doctor, 'Новий план');
  const before = await plan(patient);
  await patient.goto(`./#/plan/import?code=${second.code}`);
  await patient.context().setOffline(true);
  await patient.getByRole('button', { name: 'Переглянути план', exact: true }).click();
  await expect(patient.getByRole('alert')).toContainText('Немає зʼєднання');
  await patient.context().setOffline(false);
  expect(await plan(patient)).toEqual(before); // the plan is whole: Метформін, the test and the visit, nothing more
  await patient.context().close(); await doctor.context().close();
});

test('refusals: an expired code, a revoked code, «Не зараз» — understandable, and the plan is untouched', async ({ browser }) => {
  const doctor = await doctorSignsIn(browser);
  const expired = await issue(doctor, 'Прострочений план');
  const db = new DatabaseSync('.e2e/api.db');
  db.prepare('UPDATE plan_delivery SET expires = ? WHERE id = ?').run(Date.now() - 1000, expired.deliveryId);
  db.close();
  const patient = await cleanPhone(browser, new Date());
  await patient.goto(`./#/plan/import?code=${expired.code}`);
  await patient.getByRole('button', { name: 'Переглянути план', exact: true }).click();
  await expect(patient.getByRole('alert')).toHaveText('Термін дії коду минув. Попросіть клініку видати новий.');

  await doctor.getByRole('button', { name: 'Новий план', exact: true }).click();
  const revoked = await issue(doctor, 'Скасований план');
  await doctor.getByRole('button', { name: 'Скасувати', exact: true }).click();
  await expect(doctor.getByRole('status').filter({ hasText: 'Статус: скасовано' })).toBeVisible();
  await patient.goto(`./#/plan/import?code=${revoked.code}`);
  await patient.getByRole('button', { name: 'Переглянути план', exact: true }).click();
  await expect(patient.getByRole('alert')).toHaveText('Клініка скасувала цей код.');

  await doctor.getByRole('button', { name: 'Новий план', exact: true }).click();
  const later = await issue(doctor, 'План на потім');
  await patient.goto(`./#/plan/import?code=${later.code}`);
  await patient.getByRole('button', { name: 'Переглянути план', exact: true }).click();
  await patient.getByRole('button', { name: 'Не зараз', exact: true }).click();
  await expect(patient.getByRole('status').filter({ hasText: 'Нічого не ввімкнено' })).toBeVisible();
  const p = await plan(patient);
  expect(p?.prescriptions ?? []).toEqual([]); // nothing was activated
  expect((p?.constraints ?? []).length).toBe(0);
  await patient.context().close(); await doctor.context().close();
});
