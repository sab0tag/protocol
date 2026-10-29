import { expect, test } from '@playwright/test';
import { device } from './helpers';

test('leaving during Retry-After cancels the queued redemption without consuming the code', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.clock.install();
  const code = 'd'.repeat(43);
  const calls: unknown[] = [];
  await page.route('**/v1/clinic/plans/redeem', async (route) => {
    calls.push(route.request().postDataJSON().code);
    await route.fulfill({ status: 503, headers: { 'Retry-After': '2' }, json: { error: 'database_busy' } });
  });
  await page.goto(`./#/plan/import?code=${code}`);
  await page.getByRole('button', { name: 'Переглянути план', exact: true }).click();
  await page.getByRole('button', { name: 'Повторити', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Завантажуємо…', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'План лікаря', exact: true }).click();
  await expect(page).toHaveURL(/#\/plan$/);
  await expect(page.getByRole('heading', { name: 'План від клініки', exact: true })).toHaveCount(0);
  await page.clock.runFor(2500);
  expect(calls).toEqual([code]);
  await page.context().close();
});

// ACCESS-00-H: a busy server changed nothing, so the patient retries on the same screen with the code kept in memory.
test('database_busy: the message and a Повторити button; the retry waits Retry-After, reuses the code, never puts it back in the URL or storage', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const code = 'c'.repeat(43);
  const plan = { schemaVersion: 1, planId: '11111111-1111-4111-8111-111111111111', organizationId: 'org-1', issuedAt: '2026-10-01T10:00:00+03:00',
    clinician: { displayName: 'Лікар', organizationName: 'Клініка' }, title: 'План після повтору',
    medications: [{ name: 'Магній', dose: '1 табл', frequency: '1 раз на день', duration: '', instructions: '' }], restrictions: [], tests: [] };
  const calls: { code: unknown; at: number }[] = [];
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  await page.route('**/v1/clinic/plans/redeem', async (r) => {
    calls.push({ code: r.request().postDataJSON().code, at: Date.now() });
    if (calls.length === 1) return r.fulfill({ status: 503, headers: { 'Retry-After': '1' }, json: { error: 'database_busy' } });
    await held; // keep the retry in flight to see the button blocked
    return r.fulfill({ json: { plan } });
  });

  await page.goto(`./#/plan/import?code=${code}`);
  await page.getByRole('button', { name: 'Переглянути план' }).click();
  await expect(page.getByRole('alert')).toHaveText('Сервіс тимчасово зайнятий. Спробуйте ще раз');
  const retry = page.getByRole('button', { name: 'Повторити' });
  await expect(retry).toBeEnabled();
  expect(page.url()).not.toContain(code);
  expect(await page.evaluate((c) => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }), code)).not.toContain(code);

  await retry.click();
  const busyButton = page.getByRole('button', { name: 'Завантажуємо…' });
  await expect(busyButton).toBeDisabled();
  await expect.poll(() => calls.length).toBe(2);
  await expect(busyButton).toBeDisabled(); // still blocked while the request is in flight
  release();

  await expect(page.getByText('План після повтору — Лікар, Клініка')).toBeVisible();
  expect(calls[1]!.code).toBe(code);
  expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(900); // Retry-After: 1 was honoured
  expect(page.url()).not.toContain(code);
});
