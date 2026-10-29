import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
const inbox = () => JSON.parse(readFileSync('.e2e/invitations.json', 'utf8')) as { to: string; code: string }[];

test('SMTP invitation → fresh recipient login → preview and explicit membership acceptance; link secret never persists', async ({ browser }) => {
  const adminContext = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const recipientContext = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block', viewport: { width: 320, height: 844 } });
  try {
    const admin = await adminContext.newPage(); await admin.goto('./#/clinic');
    await admin.getByRole('link', { name: 'Увійти через захищений сервіс' }).click(); await admin.getByRole('button', { name: 'Continue as Admin', exact: true }).click();
    await admin.getByRole('combobox', { name: 'Клініка', exact: true }).selectOption({ label: 'Synthetic OIDC Clinic' });
    await admin.getByLabel('Імʼя запрошеного').fill('Synthetic invited doctor'); await admin.getByLabel('Адреса запрошеного').fill('same-contact@example.invalid');
    await admin.getByRole('button', { name: 'Надіслати запрошення', exact: true }).click();
    await expect(admin.getByRole('status')).toContainText('Запрошення передано поштовому серверу');
    const secret = inbox().at(-1)!.code;
    const recipient = await recipientContext.newPage(); await recipient.goto(`./#/clinic/invite?code=${secret}`);
    await expect(recipient).toHaveURL(/#\/clinic\/invite$/);
    expect(await recipient.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain(secret);
    const [login] = await Promise.all([recipient.waitForEvent('popup'), recipient.getByRole('link', { name: 'Увійти в новій вкладці', exact: true }).click()]);
    await login.getByLabel('Synthetic subject suffix').fill(crypto.randomUUID());
    await login.getByRole('button', { name: 'Continue as Invitee', exact: true }).click(); await expect(login).toHaveURL(/#\/clinic$/);
    await login.close(); await recipient.bringToFront(); await recipient.getByRole('button', { name: 'Перевірити вхід', exact: true }).click();
    await recipient.getByRole('button', { name: 'Переглянути запрошення', exact: true }).click();
    await expect(recipient.getByText('Synthetic OIDC Clinic · Synthetic invited doctor', { exact: true })).toBeVisible();
    await expect(recipient.getByRole('button', { name: 'Прийняти запрошення', exact: true })).toBeDisabled();
    await recipient.getByRole('checkbox', { name: 'Хочу вступити до цієї клініки з указаними ролями' }).check();
    await recipient.getByRole('button', { name: 'Прийняти запрошення', exact: true }).click();
    await expect(recipient.getByRole('status')).toContainText('Запрошення прийнято');
    await recipient.getByRole('link', { name: 'Відкрити кабінет', exact: true }).click();
    await expect(recipient.getByLabel('Назва плану')).toBeVisible(); await expect(recipient.getByText(/Synthetic invited doctor, Synthetic OIDC Clinic/)).toBeVisible();
    expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await adminContext.close(); await recipientContext.close(); }
});

test('operator invitation claims an existing admin ID; clinic cutover rejects its old token', async ({ browser, request }) => {
  const output = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/clinic/createOrg.ts', 'Synthetic bootstrap clinic', 'Synthetic existing admin'], { env: { ...process.env, DB_PATH: '.e2e/api.db' }, encoding: 'utf8' });
  const org = /organization: (\S+)/.exec(output)![1]!, token = /admin token \(shown once, store it safely\): (\S+)/.exec(output)![1]!;
  const old = await request.get('http://localhost:8099/v1/clinic/me', { headers: { Authorization: `Bearer ${token}` } }); const member = (await old.json()).memberId;
  const smtp = JSON.parse(readFileSync('.e2e/smtp.json', 'utf8'));
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/clinic/inviteCli.ts', org, member, 'same-contact@example.invalid'], { env: { ...process.env, ...smtp, DB_PATH: '.e2e/api.db', APP_ORIGIN: 'http://localhost:4318', NODE_EXTRA_CA_CERTS: '.e2e/issuer.crt' }, encoding: 'utf8' });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  try {
    const page = await context.newPage(); await page.goto('./#/clinic'); await page.getByRole('link', { name: 'Увійти через захищений сервіс' }).click();
    await page.getByRole('button', { name: 'Continue as Bootstrap', exact: true }).click(); await expect(page).toHaveURL(/#\/clinic$/);
    await page.goto(`./#/clinic/invite?code=${inbox().at(-1)!.code}`); await page.getByRole('button', { name: 'Переглянути запрошення', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Хочу вступити до цієї клініки з указаними ролями' }).check(); await page.getByRole('button', { name: 'Прийняти запрошення', exact: true }).click();
    await page.getByRole('link', { name: 'Відкрити кабінет', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Кабінет клініки', exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Перевіряємо сесію…' })).toHaveCount(0);
    const selector = page.getByRole('combobox', { name: 'Клініка', exact: true }); if (await selector.count()) await selector.selectOption(org);
    await expect(page.getByText('Ще не приєдналися: 0.', { exact: false })).toBeVisible();
    await page.getByRole('combobox', { name: 'Старі токени діятимуть ще' }).selectOption('0');
    await page.getByRole('checkbox', { name: 'Співробітники перевірили новий вхід; підтверджую відключення токенів' }).check(); await page.getByRole('button', { name: 'Почати перехід', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Дедлайн старих токенів зафіксовано');
    expect((await request.get('http://localhost:8099/v1/clinic/me', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
    const profile = await page.evaluate(async org => { const r = await fetch(`http://localhost:8099/v1/clinic/me`, { credentials: 'include', headers: { 'X-Clinic-Id': org } }); return r.json(); }, org);
    expect(profile.memberId).toBe(member); expect(profile.roles).toEqual(['admin']); await expect(page.getByLabel('Назва плану')).toHaveCount(0);
  } finally { await context.close(); }
});

test('lost invitation response retries the same key and does not submit a second SMTP message', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  try {
    const page = await context.newPage(); await page.goto('./#/clinic'); await page.getByRole('link', { name: 'Увійти через захищений сервіс' }).click();
    await page.getByRole('button', { name: 'Continue as Admin', exact: true }).click();
    await page.getByRole('combobox', { name: 'Клініка', exact: true }).selectOption({ label: 'Synthetic OIDC Clinic' });
    await page.getByLabel('Імʼя запрошеного').fill('Synthetic retry invite'); await page.getByLabel('Адреса запрошеного').fill('retry@example.invalid');
    const count = inbox().length, keys: string[] = []; let loseFirst = true;
    await page.route('**/v1/clinic/invitations', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      keys.push(route.request().headers()['idempotency-key']!);
      if (loseFirst) { loseFirst = false; const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed'); }
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Надіслати запрошення', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Немає зʼєднання');
    expect(inbox()).toHaveLength(count+1);
    await page.getByRole('button', { name: 'Надіслати запрошення', exact: true }).click(); await expect(page.getByRole('status')).toContainText('Запрошення передано поштовому серверу');
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]); expect(inbox()).toHaveLength(count+1);
  } finally { await context.close(); }
});
