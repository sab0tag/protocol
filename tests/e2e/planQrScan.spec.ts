// D177: «Додати план → QR або посилання від клініки» reads the clinic's QR with the camera inside the app (on an iPhone
// home-screen app the system camera would open Safari — another storage) or takes a pasted link. The camera is stubbed
// with a canvas showing a real QR of a real issued plan.
import { execFileSync } from 'node:child_process';
import { expect, test, type Browser, type Page } from '@playwright/test';
import qrcode from 'qrcode-generator';

const API = 'http://localhost:8099';

async function issuedCode(browser: Browser, request: import('@playwright/test').APIRequestContext): Promise<string> {
  const output = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/clinic/createOrg.ts', 'QR Clinic', 'Адмін'],
    { env: { ...process.env, DB_PATH: '.e2e/api.db' }, encoding: 'utf8' });
  const admin = /admin token \(shown once, store it safely\): (\S+)/.exec(output)![1]!;
  const doctor = await (await request.post(`${API}/v1/clinic/staff`, { headers: { Authorization: `Bearer ${admin}` }, data: { displayName: 'Лікар QR', role: 'doctor' } })).json() as { token: string };
  const me = await (await request.get(`${API}/v1/clinic/me`, { headers: { Authorization: `Bearer ${doctor.token}` } })).json() as { organizationId: string };
  const plan = { schemaVersion: 1, planId: crypto.randomUUID(), organizationId: me.organizationId, issuedAt: new Date().toISOString(),
    clinician: { displayName: 'Лікар QR', organizationName: 'QR Clinic' }, title: 'План з камери',
    medications: [{ name: 'Синтетичний препарат', dose: '1 одиниця', frequency: '1 раз на день', duration: '7 днів', instructions: '' }], restrictions: [], tests: [] };
  const res = await request.post(`${API}/v1/clinic/plans`, { headers: { Authorization: `Bearer ${doctor.token}` }, data: { plan, patientConsent: true } });
  expect(res.status()).toBe(201);
  void browser;
  return (await res.json() as { code: string }).code;
}

/** The camera shows this text as a QR: a canvas stream instead of a real camera. */
async function cameraShowing(page: Page, text: string) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  await page.addInitScript((src) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const img = new Image(); img.src = src; await img.decode();
      const c = document.createElement('canvas'); c.width = 480; c.height = 480;
      const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 480, 480); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, 40, 40, 400, 400);
      setInterval(() => ctx.drawImage(img, 40, 40, 400, 400), 100); // a live stream needs frames
      return c.captureStream(10);
    };
  }, q.createDataURL(8, 4));
}

test('the clinic’s QR read by the camera inside the app: the plan shows without another tap (D177)', async ({ browser, request }) => {
  const code = await issuedCode(browser, request);
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await cameraShowing(page, `http://localhost:4318/#/plan/import?code=${code}`);
    await page.goto('./#/plan/import');
    await expect(page.getByRole('button', { name: 'Переглянути план' })).toHaveCount(0); // no dead button without a code
    await page.getByRole('button', { name: 'Сканувати QR камерою' }).click();
    await expect(page.getByRole('heading', { name: '«QR Clinic» надіслала вам план' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/План з камери/)).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe('#/plan/import'); // the code left the address
  } finally { await context.close(); }
});

test('a QR that is not a plan is said so and sends nothing; a pasted link opens the plan (D177)', async ({ browser, request }) => {
  const code = await issuedCode(browser, request);
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const redeems: string[] = [];
    page.on('request', (r) => { if (r.url().endsWith('/v1/clinic/plans/redeem')) redeems.push(r.url()); });
    await cameraShowing(page, 'WIFI:S:home;T:WPA;P:secret;;');
    await page.goto('./#/plan/import');
    await page.getByRole('button', { name: 'Сканувати QR камерою' }).click();
    await expect(page.getByRole('alert')).toContainText('Це не QR плану від клініки', { timeout: 15_000 });
    expect(redeems).toEqual([]);
    await page.getByRole('button', { name: 'Закрити камеру' }).click();
    const field = page.getByLabel('Або вставте посилання чи код від клініки');
    await field.fill('https://example.com/not-a-plan');
    await page.getByRole('button', { name: 'Відкрити' }).click();
    await expect(page.getByRole('alert')).toContainText('Це не посилання на план від клініки');
    await field.fill(`http://localhost:4318/#/plan/import?code=${code}`);
    await page.getByRole('button', { name: 'Відкрити' }).click();
    await expect(page.getByText(/План з камери/)).toBeVisible();
    expect(redeems).toHaveLength(1);
  } finally { await context.close(); }
});
