import { expect, test, type Browser, type Page } from '@playwright/test';

async function clinic(browser: Browser, blockWorker = false) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: blockWorker ? 'block' : 'allow', viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); await page.goto('./#/clinic');
  await expect(page.getByRole('heading', { name: 'Кабінет клініки' })).toBeVisible();
  return { context, page };
}
async function login(page: Page, role: 'Doctor' | 'Admin' | 'Outsider') {
  await page.getByRole('link', { name: 'Увійти через захищений сервіс' }).click();
  await page.getByRole('button', { name: `Continue as ${role}`, exact: true }).click();
  await expect(page).toHaveURL(/#\/clinic$/);
  if (role === 'Admin') await page.getByRole('combobox', { name: 'Клініка', exact: true }).selectOption({ label: 'Synthetic OIDC Clinic' });
}
test('OIDC + PKCE + MFA cookie login survives reload, issues a real plan, and logout preserves the local journal', async ({ browser }) => {
  const { context, page } = await clinic(browser);
  try {
    await login(page, 'Doctor');
    await expect(page.getByLabel('Назва плану')).toBeVisible();
    const cookies = await context.cookies(); const sid = cookies.find(c => c.name === '__Host-psess')!;
    expect(sid.httpOnly).toBe(true); expect(sid.sameSite).toBe('Lax');
    expect(await page.evaluate(() => document.cookie)).not.toContain(sid.value);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain(sid.value);
    await page.reload(); await expect(page.getByLabel('Назва плану')).toBeVisible();
    await page.evaluate(async () => {
      const open = indexedDB.open('protocol'); await new Promise<void>(resolve => { open.onsuccess = () => resolve(); });
      const tx = open.result.transaction('entries', 'readwrite');
      tx.objectStore('entries').put({ id: 'local-oidc-test', at: new Date().toISOString(), kind: 'symptom', title: 'Synthetic local note', status: 'done', symptoms: ['Synthetic'] });
      await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); open.result.close();
    });
    await page.getByLabel('Назва плану').fill('Synthetic OIDC plan');
    await page.getByLabel(/^Ліки /).fill('Synthetic medicine | 1 unit | daily | 7 days | confirm');
    await page.getByRole('checkbox', { name: 'Пацієнт погодився отримати цей план у застосунок.' }).check();
    await page.getByRole('button', { name: 'Створити QR', exact: true }).click();
    await expect(page.getByText(/Покажіть пацієнту цей QR/)).toBeVisible();
    await page.getByRole('button', { name: 'Вийти', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Увійти через захищений сервіс' })).toBeVisible();
    expect((await context.cookies()).some(c => c.name === '__Host-psess')).toBe(false);
    const count = await page.evaluate(async () => {
      const open = indexedDB.open('protocol'); await new Promise<void>(resolve => { open.onsuccess = () => resolve(); });
      const read = open.result.transaction('entries').objectStore('entries').count();
      const n = await new Promise<number>(resolve => { read.onsuccess = () => resolve(read.result); }); open.result.close(); return n;
    });
    expect(count).toBe(1);
  } finally { await context.close().catch(() => undefined); }
});
test('step-up rotates the session; revoke-all rejects a second browser; an unrelated identity receives no clinic membership', async ({ browser }) => {
  const one = await clinic(browser), two = await clinic(browser), outsider = await clinic(browser);
  try {
    await login(one.page, 'Admin'); await login(two.page, 'Admin');
    await expect(one.page.getByRole('heading', { name: /Плани за/ })).toBeVisible();
    const old = (await one.context.cookies()).find(c => c.name === '__Host-psess')!.value;
    await one.page.getByRole('link', { name: 'Підтвердити вхід ще раз' }).click();
    await one.page.getByRole('button', { name: 'Continue as Admin', exact: true }).click();
    await one.page.getByRole('combobox', { name: 'Клініка', exact: true }).selectOption({ label: 'Synthetic OIDC Clinic' });
    await expect(one.page.getByRole('heading', { name: /Плани за/ })).toBeVisible();
    expect((await one.context.cookies()).find(c => c.name === '__Host-psess')!.value).not.toBe(old);
    await one.page.getByRole('button', { name: 'Завершити всі сесії', exact: true }).click();
    await expect(one.page.getByRole('link', { name: 'Увійти через захищений сервіс' })).toBeVisible();
    await two.page.reload(); await expect(two.page.getByRole('link', { name: 'Увійти через захищений сервіс' })).toBeVisible();
    await expect(two.page.getByRole('heading', { name: /Плани за/ })).toHaveCount(0);
    await login(outsider.page, 'Outsider');
    await expect(outsider.page.getByText(/немає доступних клінік/)).toBeVisible();
    await expect(outsider.page.getByLabel('Назва плану')).toHaveCount(0);
    await expect(outsider.page.getByRole('heading', { name: /Плани за/ })).toHaveCount(0);
  } finally { await one.context.close().catch(() => undefined); await two.context.close().catch(() => undefined); await outsider.context.close().catch(() => undefined); }
});

test('switching clinic aborts old-context requests and discards late responses', async ({ browser }) => {
  const { context, page } = await clinic(browser, true);
  try {
    await login(page, 'Admin');
    await expect(page.getByText(/Synthetic OIDC Admin, Synthetic OIDC Clinic/)).toBeVisible();
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
    await page.route('**/v1/clinic/stats*', async route => {
      started(); await held;
      await route.fulfill({ json: { days: 30, issued: 9999, redeemed: 0, pending: 9999, expired: 0, revoked: 0, byDoctor: [] } }).catch(() => undefined);
    }, { times: 1 });
    // Hold the second context response, then return to the first context while it is in flight.
    await page.getByRole('combobox', { name: 'Клініка', exact: true }).selectOption({ label: 'Synthetic OIDC Second Clinic' });
    await ready;
    const aborted = page.waitForEvent('requestfailed', { predicate: r => r.url().includes('/v1/clinic/stats') });
    await page.getByRole('combobox', { name: 'Клініка', exact: true }).selectOption({ label: 'Synthetic OIDC Clinic' });
    await expect(page.getByText(/Synthetic OIDC Admin, Synthetic OIDC Clinic/)).toBeVisible();
    await aborted; release();
    await expect(page.getByText(/Видано: 9999/)).toHaveCount(0);
  } finally { await context.close().catch(() => undefined); }
});
