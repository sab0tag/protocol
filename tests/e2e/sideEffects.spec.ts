import { expect, test } from '@playwright/test';
import { device, seed, toast, ymd } from './helpers';
import { emptyPlan } from '../../src/data/seed.example';
import { t } from '../../src/i18n/uk';

// D194: a new medicine — «є побічні?» once a day for 14 days; «Так» and a word go to the report; a danger word — the 103 card.
const day = (n: number) => ymd(new Date(Date.now() + n * 86_400_000));
const planWith = () => ({ store: 'plan', value: { ...emptyPlan(), id: 'main', onboardedAt: day(-5),
  prescriptions: [{ id: 'p-om', kind: 'medication', title: 'Омепразол', dose: '20 мг', schedule: { times: ['07:00'], withFood: false }, since: day(-2), source: 'лікар' }] } });

test('«Так» and a word → recorded, the card leaves for today, the report shows it', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [planWith()]);
  await page.goto('./#/');
  const card = page.getByTestId('side-effects');
  await expect(card).toContainText(t.side.ask('Омепразол', 3));
  await card.getByRole('button', { name: t.side.yes }).click();
  await card.getByPlaceholder(t.side.which).fill('нудота');
  await card.getByRole('button', { name: t.side.save }).click();
  await expect(toast(page)).toContainText(t.side.saved);
  await expect(card).toHaveCount(0);
  await page.goto('./#/report');
  await expect(page.getByTestId('report-side-effects')).toContainText('Омепразол');
  await expect(page.getByTestId('report-side-effects')).toContainText('нудота');
});

test('a danger word in the answer brings the 103 card', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [planWith()]);
  await page.goto('./#/');
  const card = page.getByTestId('side-effects');
  await card.getByRole('button', { name: t.side.yes }).click();
  await card.getByPlaceholder(t.side.which).fill('тисне в грудях');
  await card.getByRole('button', { name: t.side.save }).click();
  await expect(page.getByText(t.symptom.dangerAlert)).toBeVisible();
});
