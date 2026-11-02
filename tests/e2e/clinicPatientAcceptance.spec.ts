import { execFileSync } from 'node:child_process';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

const API = 'http://localhost:8099';

function createClinic(name: string): string {
  const output = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/clinic/createOrg.ts', name, 'Адмін'],
    { env: { ...process.env, DB_PATH: '.e2e/api.db' }, encoding: 'utf8' });
  const token = /admin token \(shown once, store it safely\): (\S+)/.exec(output)?.[1];
  if (!token) throw new Error('synthetic clinic setup failed');
  return token;
}

async function addDoctor(request: APIRequestContext, adminToken: string, displayName: string) {
  const res = await request.post(`${API}/v1/clinic/staff`, { headers: { Authorization: `Bearer ${adminToken}` }, data: { displayName, role: 'doctor' } });
  expect(res.status()).toBe(201);
  return await res.json() as { token: string };
}

/** The doctor signs in with a service token and issues a real plan; returns the one-time code and the delivery id. */
async function issuePlan(browser: Browser, doctorToken: string, title: string) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const doctor = await context.newPage();
  await doctor.goto('./#/clinic');
  await doctor.getByText('Службовий токен (тимчасово)', { exact: true }).click();
  await doctor.getByLabel('Токен доступу').fill(doctorToken);
  await doctor.getByRole('button', { name: 'Увійти', exact: true }).click();
  await doctor.getByLabel('Назва плану').fill(title);
  await doctor.getByLabel(/^Ліки /).fill('Синтетичний препарат | 1 одиниця | 1 раз на день | 7 днів | з їжею');
  await doctor.getByRole('checkbox', { name: 'Пацієнт погодився отримати цей план у застосунок.' }).check();
  const response = doctor.waitForResponse(r => r.url().endsWith('/v1/clinic/plans') && r.request().method() === 'POST');
  await doctor.getByRole('button', { name: 'Створити QR', exact: true }).click();
  const issued = await (await response).json() as { deliveryId: string; code: string };
  await expect(doctor.locator('div.bg-white > svg')).toBeVisible();
  return { doctor, context, ...issued };
}

async function patientDevice(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  return await context.newPage();
}

async function localCarePlans(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const open = indexedDB.open('protocol'); await new Promise<void>(resolve => { open.onsuccess = () => resolve(); });
    if (!open.result.objectStoreNames.contains('carePlans')) { open.result.close(); return 0; }
    const count = await new Promise<number>(resolve => { open.result.transaction('carePlans').objectStore('carePlans').count().onsuccess = e => resolve((e.target as IDBRequest<number>).result); });
    open.result.close(); return count;
  });
}

const redeem = (request: APIRequestContext, code: string) => request.post(`${API}/v1/clinic/plans/redeem`, { data: { code } });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test.describe('clinic → doctor → QR → patient acceptance', () => {
  test('issued plan reaches the patient as an unverified draft and the doctor sees it received', async ({ browser, request }) => {
    const doctorToken = (await addDoctor(request, createClinic('Клініка A1'), 'Лікар A1')).token;
    const { doctor, context, code, deliveryId } = await issuePlan(browser, doctorToken, 'Акцептанс план');
    const patient = await patientDevice(browser);
    await patient.goto(`./#/plan/import?code=${code}`);
    await patient.getByRole('button', { name: 'Переглянути план', exact: true }).click();
    await expect(patient.getByText(/Видано клінікою: Лікар A1, Клініка A1/)).toBeVisible();
    await patient.getByRole('button', { name: 'Зберегти обране', exact: true }).click();
    await expect(patient.getByRole('link', { name: 'Перейти до плану' })).toBeVisible();
    expect(await localCarePlans(patient)).toBe(1);
    await doctor.getByRole('button', { name: 'Оновити статус', exact: true }).click();
    await expect(doctor.getByRole('status').filter({ hasText: 'Статус: отримано' })).toBeVisible();

    // The code is single-use, and a service token is not a key to patient-side data.
    expect((await redeem(request, code)).status()).not.toBe(200);
    expect((await redeem(request, code).then(r => r.json())).error).toBe('used');
    const vault = await request.get(`${API}/v1/vaults/${'a'.repeat(32)}/records?since=0&protocol=2&clientVersion=2`, { headers: auth(doctorToken) });
    expect([401, 403, 404]).toContain(vault.status());
    const status = await request.get(`${API}/v1/clinic/plans/${deliveryId}`, { headers: auth(doctorToken) });
    expect((await status.json()).status).toBe('redeemed');
    await context.close(); await patient.context().close();
  });

  test('a revoked plan cannot be redeemed and nothing is stored on the patient device', async ({ browser, request }) => {
    const doctorToken = (await addDoctor(request, createClinic('Клініка A2'), 'Лікар A2')).token;
    const { context, code, deliveryId } = await issuePlan(browser, doctorToken, 'Відкликаний план');
    const revoke = await request.delete(`${API}/v1/clinic/plans/${deliveryId}`, { headers: auth(doctorToken) });
    expect(revoke.status()).toBe(200);
    const patient = await patientDevice(browser);
    await patient.goto(`./#/plan/import?code=${code}`);
    await patient.getByRole('button', { name: 'Переглянути план', exact: true }).click();
    await expect(patient.getByRole('alert')).toBeVisible();
    await expect(patient.getByRole('button', { name: 'Зберегти обране', exact: true })).toHaveCount(0);
    expect(await localCarePlans(patient)).toBe(0);
    expect((await redeem(request, code).then(r => r.json())).error).toBe('revoked');
    await context.close(); await patient.context().close();
  });

  test('a redeemed plan can no longer be revoked', async ({ browser, request }) => {
    const doctorToken = (await addDoctor(request, createClinic('Клініка A3'), 'Лікар A3')).token;
    const { context, code, deliveryId } = await issuePlan(browser, doctorToken, 'Використаний план');
    expect((await redeem(request, code)).status()).toBe(200);
    const revoke = await request.delete(`${API}/v1/clinic/plans/${deliveryId}`, { headers: auth(doctorToken) });
    expect(revoke.status()).toBe(404);
    await context.close();
  });

  test('another clinic and an anonymous caller cannot see or revoke someone else’s delivery', async ({ browser, request }) => {
    const ownerToken = (await addDoctor(request, createClinic('Клініка B1'), 'Лікар B1')).token;
    const strangerToken = (await addDoctor(request, createClinic('Клініка B2'), 'Лікар B2')).token;
    const { context, code, deliveryId } = await issuePlan(browser, ownerToken, 'Чужий план');
    expect((await request.get(`${API}/v1/clinic/plans/${deliveryId}`, { headers: auth(strangerToken) })).status()).toBe(404);
    expect((await request.delete(`${API}/v1/clinic/plans/${deliveryId}`, { headers: auth(strangerToken) })).status()).toBe(404);
    expect((await request.get(`${API}/v1/clinic/plans/${deliveryId}`)).status()).toBe(401);
    expect((await request.delete(`${API}/v1/clinic/plans/${deliveryId}`)).status()).toBe(401);
    const own = await request.get(`${API}/v1/clinic/plans/${deliveryId}`, { headers: auth(ownerToken) });
    expect((await own.json()).status).toBe('pending');
    expect((await redeem(request, code)).status()).toBe(200);
    await context.close();
  });

  test('without network the import fails safely, keeps the code unused and succeeds on retry', async ({ browser, request }) => {
    const doctorToken = (await addDoctor(request, createClinic('Клініка A4'), 'Лікар A4')).token;
    const { context, code, deliveryId } = await issuePlan(browser, doctorToken, 'Офлайн план');
    const patient = await patientDevice(browser);
    await patient.goto(`./#/plan/import?code=${code}`);
    await expect(patient.getByRole('button', { name: 'Переглянути план', exact: true })).toBeVisible();
    await patient.context().setOffline(true);
    await patient.getByRole('button', { name: 'Переглянути план', exact: true }).click();
    await expect(patient.getByRole('alert')).toBeVisible();
    expect(await localCarePlans(patient)).toBe(0);
    const pending = await request.get(`${API}/v1/clinic/plans/${deliveryId}`, { headers: auth(doctorToken) });
    expect((await pending.json()).status).toBe('pending');
    await patient.context().setOffline(false);
    await patient.getByRole('button', { name: 'Переглянути план', exact: true }).click();
    await expect(patient.getByText(/Видано клінікою: Лікар A4, Клініка A4/)).toBeVisible();
    await context.close(); await patient.context().close();
  });
  test('patient confirms a reviewed draft: it enters the plan once, without a schedule, and survives reload', async ({ browser, request }) => {
    const doctorToken = (await addDoctor(request, createClinic('Клініка A5'), 'Лікар A5')).token;
    const { context, code } = await issuePlan(browser, doctorToken, 'План до підтвердження');
    const patient = await patientDevice(browser);
    await patient.goto(`./#/plan/import?code=${code}`);
    await patient.getByRole('button', { name: 'Переглянути план', exact: true }).click();
    await patient.getByRole('button', { name: 'Зберегти обране', exact: true }).click();
    await patient.getByRole('link', { name: 'Перейти до плану' }).click();
    await patient.getByRole('button', { name: /Пропустити/ }).click();
    await patient.getByRole('navigation', { name: 'Розділи' }).getByRole('link', { name: 'План' }).click();
    const drafts = patient.getByRole('region', { name: 'Чернетки від клінік' });
    const confirm = drafts.getByRole('button', { name: 'Додати до мого плану', exact: true });
    await expect(confirm).toBeDisabled();

    await patient.goto('./#/plan/prescriptions');
    await expect(patient.getByText('Синтетичний препарат')).toHaveCount(0);

    await patient.goto('./#/plan');
    await drafts.getByRole('checkbox', { name: /Я звірив\(ла\) цей план/ }).check();
    await confirm.click();
    await expect(patient).toHaveURL(/#\/plan\/prescriptions$/);
    await expect(patient.getByText('Синтетичний препарат')).toHaveCount(1);
    await patient.reload();
    await expect(patient.getByText('Синтетичний препарат')).toHaveCount(1);
    await patient.goto('./#/plan');
    await expect(drafts.getByText('Синтетичний препарат')).toHaveCount(0);
    expect(await patient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await context.close(); await patient.context().close();
  });
});
