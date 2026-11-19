import { expect, test } from '@playwright/test';
import { device, seed, ymd } from './helpers';
import { emptyPlan } from '../../src/data/seed.example';
import { t } from '../../src/i18n/uk';

// D193: the morning of a test on an empty stomach — the breakfast tile says the test comes first; the morning medicine is a
// question for the doctor, never advice.
test('the morning of «Глюкоза натще»: «спершу аналіз» on the breakfast tile, and Метформін — «уточніть у лікаря»', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const now = new Date(); now.setHours(7, 0, 0, 0);
  await page.clock.setFixedTime(now);
  const d = ymd(now);
  await seed(page, [{ store: 'plan', value: { ...emptyPlan(), id: 'main', onboardedAt: d, prescriptions: [
    { id: 't', kind: 'test', title: 'Глюкоза натще', dueDate: d, source: 'лікар' },
    { id: 'm', kind: 'medication', title: 'Метформін', dose: '500 мг', schedule: { times: ['08:00'], withFood: true }, source: 'лікар', since: d }] } }]);
  await page.goto('./#/'); await page.reload();
  const line = page.locator('[data-testid=meal-tiles] [data-slot="0"]').getByTestId('fasting-test');
  await expect(line).toContainText(t.fastingTest.first('Глюкоза натще'));
  await expect(line).toContainText(t.fastingTest.meds('Метформін'));
});
