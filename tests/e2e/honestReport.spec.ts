import { expect, test } from '@playwright/test';
import { device, kyivOffset, seed, ymd } from './helpers';
import { emptyPlan } from '../../src/data/seed.example';
import { t } from '../../src/i18n/uk';

// D189 («Очередь агента», задача 11): the place of an injection after the dose is marked; no line through two weighings;
// the report starts with coverage and says «мало даних».

test('a marked insulin dose asks where it went, with last time\'s place; one tap writes it', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const d = ymd(new Date()), y = ymd(new Date(Date.now() - 86_400_000));
  await seed(page, [
    { store: 'plan', value: { ...emptyPlan(), id: 'main', onboardedAt: y,
      prescriptions: [{ id: 'p-ins', kind: 'medication', title: 'Лантус', dose: '12 ОД', schedule: { times: ['07:00'] }, since: y }] } },
    { store: 'entries', value: { id: 'dose-y', at: `${y}T07:05:00${kyivOffset()}`, kind: 'med', status: 'done', title: 'Лантус', prescriptionId: 'p-ins',
      checkKey: 'med:p-ins:07:00', site: { part: 'belly', side: 'left' } } },
    { store: 'entries', value: { id: 'dose-t', at: `${d}T07:05:00${kyivOffset()}`, kind: 'med', status: 'done', title: 'Лантус', prescriptionId: 'p-ins', checkKey: 'med:p-ins:07:00' } },
  ]);
  await page.goto('./#/');
  const card = page.getByTestId('injection-site');
  await expect(card).toContainText(t.injection.ask('Лантус'));
  await expect(card).toContainText(t.injection.last('живіт ліворуч'));
  await card.getByRole('button', { name: 'стегно праворуч' }).click();
  await expect(card).toHaveCount(0);
  const site = await page.evaluate(async () => {
    const req = indexedDB.open('protocol'); await new Promise((r) => { req.onsuccess = r; });
    const get = req.result.transaction('entries').objectStore('entries').get('dose-t'); await new Promise((r) => { get.onsuccess = r; });
    return (get.result as { site?: unknown }).site;
  });
  expect(site).toEqual({ part: 'thigh', side: 'right' });
});

test('two weighings — dots without a line; the report starts with coverage and says «мало даних»', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const d = ymd(new Date()), y = ymd(new Date(Date.now() - 2 * 86_400_000));
  await seed(page, [
    { store: 'plan', value: { ...emptyPlan(), id: 'main', onboardedAt: y } },
    { store: 'weights', value: { date: y, kg: 90 } }, { store: 'weights', value: { date: d, kg: 89.6 } },
  ]);
  await page.goto('./#/weight');
  await expect(page.getByTestId('weight-chart')).toHaveAttribute('data-lined', 'false');
  await expect(page.getByText(t.weightQuality.howTo)).toBeVisible();
  await page.goto('./#/report');
  const cov = page.getByTestId('report-coverage');
  await expect(cov).toContainText('Записано днів: 2 з');
  await expect(cov).toContainText(t.report.fewData);
});
