import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

test('first-login guide is shown to a signed-out doctor, fits narrow screens and disappears after sign-in', async ({ browser, request }) => {
  const output = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/clinic/createOrg.ts', 'Клініка гід', 'Адмін'],
    { env: { ...process.env, DB_PATH: '.e2e/api.db' }, encoding: 'utf8' });
  const adminToken = /admin token \(shown once, store it safely\): (\S+)/.exec(output)?.[1];
  if (!adminToken) throw new Error('synthetic clinic setup failed');
  const added = await request.post('http://localhost:8099/v1/clinic/staff', { headers: { Authorization: `Bearer ${adminToken}` }, data: { displayName: 'Лікар гід', role: 'doctor' } });
  const staff = await added.json() as { token: string };

  for (const width of [320, 390]) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 } });
    const page = await context.newPage();
    await page.goto('./#/clinic');
    await expect(page.getByRole('status').filter({ hasText: 'Перевіряємо сесію…' })).toHaveCount(0);
    const guide = page.getByRole('heading', { name: 'Перший вхід лікаря' });
    await expect(guide).toBeVisible();
    await expect(page.getByText('Доступ лікаря не надає права читати щоденник пацієнта.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.getByText('Службовий токен (тимчасово)', { exact: true }).click();
    await page.getByLabel('Токен доступу').fill('wrong-token-wrong-token-000');
    await page.getByRole('button', { name: 'Увійти', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(guide).toBeVisible();

    await page.getByLabel('Токен доступу').fill(staff.token);
    await page.getByRole('button', { name: 'Увійти', exact: true }).click();
    await expect(page.getByLabel('Назва плану')).toBeVisible();
    await expect(guide).toHaveCount(0);
    await context.close();
  }
});
