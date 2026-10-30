import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

for (const width of [320, 390]) test(`real clinic issue → QR screen → patient draft preserves issuer/source at ${width}px`, async ({ browser, request }) => {
  const actualName = width === 320 ? `Лікар ${'А'.repeat(140)}` : 'Справжній автор';
  const output = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/clinic/createOrg.ts', 'Синтетична клініка', 'Адмін'],
    { env: { ...process.env, DB_PATH: '.e2e/api.db' }, encoding: 'utf8' });
  const adminToken = /admin token \(shown once, store it safely\): (\S+)/.exec(output)?.[1];
  if (!adminToken) throw new Error('synthetic clinic setup failed');
  const added = await request.post('http://localhost:8099/v1/clinic/staff', { headers: { Authorization: `Bearer ${adminToken}` },
    data: { displayName: actualName, role: 'doctor' } });
  expect(added.status()).toBe(201);
  const staff = await added.json() as { memberId: string; token: string };
  const doctorContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 }, colorScheme: width === 320 ? 'dark' : 'light' });
  const patientContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 }, colorScheme: width === 320 ? 'dark' : 'light' });
  try {
    const doctor = await doctorContext.newPage();
    await doctor.goto('./#/clinic');
    await expect(doctor.getByRole('status').filter({ hasText: 'Перевіряємо сесію…' })).toHaveCount(0);
    await doctor.getByText('Службовий токен (тимчасово)', { exact: true }).click();
    await doctor.getByLabel('Токен доступу').fill(staff.token);
    await doctor.getByRole('button', { name: 'Увійти', exact: true }).click();
    await doctor.getByLabel('Назва плану').fill('Синтетичний план для передачі');
    await doctor.getByLabel(/^Ліки /).fill('Синтетичний препарат | 1 одиниця | 1 раз на день | 7 днів | перевірити з лікарем');
    await doctor.getByRole('checkbox', { name: 'Пацієнт погодився отримати цей план у застосунок.' }).check();
    // Send a forged source name through the real API, without stubbing its response.
    await doctor.route('**/v1/clinic/plans', (route) => {
      const body = route.request().postDataJSON();
      body.plan.clinician = { displayName: 'Заявлений лікар', organizationName: 'Заявлена клініка' };
      return route.continue({ postData: JSON.stringify(body) });
    });
    const response = doctor.waitForResponse(r => r.url().endsWith('/v1/clinic/plans') && r.request().method() === 'POST');
    await doctor.getByRole('button', { name: 'Створити QR', exact: true }).click();
    const issuedResponse = await response; expect(issuedResponse.status()).toBe(201);
    const issued = await issuedResponse.json() as { deliveryId: string; code: string };
    await expect(doctor.getByText(/Покажіть пацієнту цей QR/)).toBeVisible();
    await expect(doctor.locator('div.bg-white > svg')).toBeVisible();

    const patient = await patientContext.newPage();
    await patient.goto(`./#/plan/import?code=${issued.code}`);
    await patient.getByRole('button', { name: 'Переглянути план', exact: true }).click();
    await expect(patient.getByText(`Видано клінікою: ${actualName}, Синтетична клініка.`, { exact: true })).toBeVisible();
    await expect(patient.getByText('Автор у джерелі: Заявлений лікар, Заявлена клініка. Це імʼя не підтверджене сервером.', { exact: true })).toBeVisible();
    expect(patient.url()).not.toContain(issued.code);
    expect(await patient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await patient.getByRole('button', { name: 'Зберегти обране', exact: true }).click();
    await expect(patient.getByRole('status').filter({ hasText: 'Збережено на цьому пристрої як чернетку.' })).toBeVisible();
    await expect(patient.getByRole('link', { name: 'Перейти до плану' })).toBeVisible();
    const local = await patient.evaluate(async () => {
      const open = indexedDB.open('protocol'); await new Promise<void>(resolve => { open.onsuccess = () => resolve(); });
      const tx = open.result.transaction(['carePlans', 'carePlanItems', 'entries']);
      const read = <T>(r: IDBRequest<T>) => new Promise<T>(resolve => { r.onsuccess = () => resolve(r.result); });
      const [plans, items, entries] = await Promise.all([read(tx.objectStore('carePlans').getAll()), read(tx.objectStore('carePlanItems').getAll()), read(tx.objectStore('entries').count())]);
      open.result.close(); return { plans, items, entries };
    });
    expect(local.plans).toHaveLength(1);
    expect(local.plans[0]).toMatchObject({ status: 'draft', source: { redemption: { snapshotId: issued.deliveryId,
      issuer: { memberId: staff.memberId, displayName: actualName }, source: { clinician: { displayName: 'Заявлений лікар' } } } } });
    expect(local.items[0]).toMatchObject({ provenance: { verification: 'pending' } });
    expect(local.entries).toBe(0);
    await patient.getByRole('link', { name: 'Перейти до плану' }).click();
    await expect(patient).toHaveURL(/#\/plan$/);
    await expect(patient.getByRole('heading', { name: 'План лікаря — щоденні дії' })).toBeVisible();
    await patient.getByRole('button', { name: /Пропустити/ }).click();
    await patient.goto('./#/plan');
    await expect(patient.getByRole('heading', { name: 'План лікаря', exact: true })).toBeVisible();
    const drafts = patient.getByRole('region', { name: 'Чернетки від клінік' });
    await expect(drafts).toContainText('Синтетичний план для передачі');
    await expect(drafts).toContainText('Синтетичний препарат');
    await expect(drafts).toContainText('потребує перевірки');
    await doctor.getByRole('button', { name: 'Оновити статус', exact: true }).click();
    await expect(doctor.getByRole('status').filter({ hasText: 'Статус: отримано' })).toBeVisible();
  } finally { await doctorContext.close().catch(() => undefined); await patientContext.close().catch(() => undefined); }
});
