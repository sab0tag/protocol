import { expect, test } from '@playwright/test';
import { device, seed } from './helpers';

const date = '2026-10-27';

test('the report leaves the device only after explicit consent that names what is shared', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.clock.setFixedTime(new Date('2026-10-28T12:00:00+02:00'));
  await seed(page, [
    { store: 'plan', value: { id: 'main', onboardedAt: date, lastVisit: date, constraints: [], targets: {}, modes: [], questions: ['Чи змінювати дозу?'],
      prescriptions: [{ id: 'one', title: 'Тестовий препарат', kind: 'medication', dose: '1 таб.', source: 'Тест', since: date, schedule: { times: ['08:30'] } }] } },
    { store: 'weights', value: { date, kg: 80 } },
  ]);
  await page.goto('./#/report');
  await page.evaluate(() => { document.body.dataset.shareCalls = '0'; Object.defineProperty(navigator, 'share', { configurable: true,
    value: async () => { document.body.dataset.shareCalls = String(Number(document.body.dataset.shareCalls) + 1); } }); });
  const shareCalls = () => page.locator('body').getAttribute('data-share-calls');

  await page.getByRole('button', { name: 'Поділитися', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Підтвердження передачі' });
  await expect(panel).toContainText('вага');
  await expect(panel).toContainText('ваші питання');
  const send = panel.getByRole('button', { name: 'Передати звіт', exact: true });
  await expect(send).toBeDisabled();
  expect(await shareCalls()).toBe('0');

  await panel.getByRole('button', { name: 'Скасувати', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(await shareCalls()).toBe('0');

  await page.getByRole('button', { name: 'Поділитися', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Передати звіт', exact: true })).toBeDisabled();
  await panel.getByRole('checkbox', { name: /Я погоджуюсь передати/ }).check();
  await panel.getByRole('button', { name: 'Передати звіт', exact: true }).click();
  await expect.poll(shareCalls).toBe('1');
  await expect(panel).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole('button', { name: 'Поділитися', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.context().close();
});

test('consent applies to the exact report: changing the period or adding a question requires confirmation again', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.clock.setFixedTime(new Date('2026-10-28T12:00:00+02:00'));
  await seed(page, [
    { store: 'plan', value: { id: 'main', onboardedAt: date, lastVisit: date, constraints: [], targets: {}, modes: [], prescriptions: [] } },
    { store: 'entries', value: { id: 'skip', at: `${date}T12:00:00+02:00`, kind: 'meal', status: 'skipped', title: 'Тестовий обід', skipReason: 'Тестова причина' } },
  ]);
  await page.goto('./#/report');
  await page.evaluate(() => { document.body.dataset.shareCalls = '0'; Object.defineProperty(navigator, 'share', { configurable: true,
    value: async (data: ShareData) => { document.body.dataset.shareCalls = String(Number(document.body.dataset.shareCalls) + 1); document.body.dataset.sharedReport = data.text; } }); });
  await page.getByRole('button', { name: 'Поділитися', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Підтвердження передачі' });
  const agree = panel.getByRole('checkbox', { name: /Я погоджуюсь передати/ });
  const send = panel.getByRole('button', { name: 'Передати звіт', exact: true });
  await agree.check();
  await expect(send).toBeEnabled();
  await page.getByLabel('З', { exact: true }).fill('2026-10-28');
  await expect(panel).not.toContainText('підтверджені пропуски та їх причини');
  await expect(send).toBeDisabled();
  await expect(agree).not.toBeChecked();
  await expect(page.locator('body')).toHaveAttribute('data-share-calls', '0');

  await agree.check();
  await page.getByRole('textbox', { name: 'Додати питання', exact: true }).fill('Нове питання після згоди');
  await page.getByRole('button', { name: 'Додати', exact: true }).click();
  await expect(panel).toContainText('ваші питання');
  await expect(send).toBeDisabled();
  await expect(agree).not.toBeChecked();
  await expect(page.locator('body')).toHaveAttribute('data-share-calls', '0');
  await agree.check();
  await send.click();
  await expect(page.locator('body')).toHaveAttribute('data-share-calls', '1');
  await expect(page.locator('body')).toHaveAttribute('data-shared-report', /Нове питання після згоди/);
  await page.context().close();
});
