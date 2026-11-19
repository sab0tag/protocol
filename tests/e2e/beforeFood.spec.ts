import { expect, test } from '@playwright/test';
import { device, kyivOffset, seed, ymd } from './helpers';
import { emptyPlan } from '../../src/data/seed.example';
import { t } from '../../src/i18n/uk';

// D192: an empty-stomach medicine marked — the breakfast tile says how long to wait, as the plan gives the minutes.
test('marked Омепразол «за 30 хв до їжі» → «Сніданок через 20 хв» on the breakfast tile; breakfast written — gone', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const now = new Date(); now.setHours(7, 10, 0, 0);
  await page.clock.setFixedTime(now);
  const d = ymd(now);
  await seed(page, [
    { store: 'plan', value: { ...emptyPlan(), id: 'main', onboardedAt: d,
      prescriptions: [{ id: 'p-om', kind: 'medication', title: 'Омепразол', dose: '20 мг', schedule: { times: ['07:00'], withFood: false }, beforeFoodMin: 30, source: 'лікар', since: d }] } },
    { store: 'entries', value: { id: 'dose', at: `${d}T07:00:00${kyivOffset(now)}`, kind: 'med', status: 'done', title: 'Омепразол', prescriptionId: 'p-om', checkKey: 'med:p-om:07:00' } },
  ]);
  await page.goto('./#/'); await page.reload();
  const breakfast = page.locator('[data-testid=meal-tiles] [data-slot="0"]');
  await expect(breakfast.getByTestId('before-food')).toHaveText(t.fasting.wait(20, 'Омепразол'));
});
