import { expect, test, type Page } from '@playwright/test';
import { device, seed, toast, ymd } from './helpers';
import { emptyPlan } from '../../src/data/seed.example';
import { t } from '../../src/i18n/uk';

// D195: the browser runs in Europe/Kyiv; a plan whose home is Warsaw is «away, +1 год». Nothing moves without an answer.
const times = (page: Page) => page.evaluate(async () => {
  const r = indexedDB.open('protocol'); await new Promise((ok) => { r.onsuccess = ok; });
  const g = r.result.transaction('plan').objectStore('plan').get('main'); await new Promise((ok) => { g.onsuccess = ok; });
  return (g.result as { prescriptions: { schedule?: { times: string[] } }[] }).prescriptions[0]!.schedule!.times;
});
const plan = (zone: unknown) => ({ store: 'plan', value: { ...emptyPlan(), id: 'main', onboardedAt: ymd(new Date()), zone,
  prescriptions: [{ id: 'm', kind: 'medication', title: 'Метформін', dose: '500 мг', schedule: { times: ['08:30'], withFood: true }, source: 'лікар' }] } });

test('away: the question, nothing moved until «Як удома», then the doses at home time', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [plan({ home: 'Europe/Warsaw' })]);
  await page.goto('./#/');
  const card = page.getByTestId('zone-card');
  await expect(card).toContainText(t.zone.away('+1'));
  expect(await times(page)).toEqual(['08:30']); // asked, not moved
  await card.getByRole('button', { name: new RegExp(t.zone.home) }).click();
  await expect(toast(page)).toContainText(t.zone.saved);
  await expect(card).toHaveCount(0);
  expect(await times(page)).toEqual(['09:30']);
});

test('back home with a shift: «Повернути» moves the times back', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [plan({ home: 'Europe/Kyiv', shift: { zone: 'Europe/Warsaw', minutes: -60 } })]);
  await page.goto('./#/');
  const card = page.getByTestId('zone-card');
  await expect(card).toContainText(t.zone.back);
  await card.getByRole('button', { name: t.zone.backYes }).click();
  await expect(card).toHaveCount(0);
  expect(await times(page)).toEqual(['09:30']);
});
