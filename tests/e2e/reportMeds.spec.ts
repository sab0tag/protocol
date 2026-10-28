import { expect, test, type Page } from '@playwright/test';
import { device, seed } from './helpers';

const date = '2026-10-27';
const prescription = (id: string, title: string) => ({ id, title, kind: 'medication', dose: '1 таб.', source: 'Тест',
  since: date, schedule: { times: ['08:30'] } });
const water = { id: 'water', at: `${date}T12:00:00+02:00`, kind: 'water', status: 'done', title: 'Вода', waterMl: 250 };

async function shareText(page: Page) {
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true,
    value: async (data: ShareData) => { document.body.dataset.sharedReport = data.text; } }));
  await page.getByRole('button', { name: 'Поділитися', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-shared-report', /Звіт за/);
  return (await page.locator('body').getAttribute('data-shared-report'))!;
}

test('water alone leaves medicine unmarked in the report, print and shared text', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.clock.setFixedTime(new Date('2026-10-28T12:00:00+02:00'));
  await seed(page, [
    { store: 'plan', value: { id: 'main', onboardedAt: date, lastVisit: date, constraints: [], targets: {}, modes: [],
      prescriptions: [prescription('one', 'Тестовий препарат')] } },
    { store: 'entries', value: water },
  ]);
  await page.goto('./#/report');
  const main = page.getByRole('region', { name: 'Головне' });
  await expect(main).toContainText('0 з 1 доз у дні з записами');
  await expect(main).toContainText('Без відмітки: 1 доз.');
  await expect(main).not.toContainText('пропущено');
  await expect(main).toContainText('Дні без записів не оцінюються');
  const text = await shareText(page);
  expect(text).toContain('Без відмітки: 1 доз.');
  expect(text).not.toContain('пропущено');
  await page.emulateMedia({ media: 'print' });
  await expect(main.getByText('Без відмітки: 1 доз.', { exact: true })).toBeVisible();
  await expect(main).not.toContainText('пропущено');
});

test('several medicines retain an explicit skip alongside a taken and an unmarked dose', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.clock.setFixedTime(new Date('2026-10-28T12:00:00+02:00'));
  await seed(page, [
    { store: 'plan', value: { id: 'main', onboardedAt: date, lastVisit: date, constraints: [], targets: {}, modes: [],
      prescriptions: [prescription('taken', 'Препарат А'), prescription('skipped', 'Препарат Б'), prescription('unknown', 'Препарат В')] } },
    { store: 'entries', value: water },
    { store: 'entries', value: { id: 'taken', at: `${date}T08:35:00+02:00`, kind: 'med', status: 'done', title: 'Препарат А', checkKey: 'med:taken:08:30', prescriptionId: 'taken' } },
    { store: 'entries', value: { id: 'skipped', at: `${date}T08:30:00+02:00`, kind: 'med', status: 'skipped', title: 'Препарат Б', checkKey: 'med:skipped:08:30', prescriptionId: 'skipped' } },
  ]);
  await page.goto('./#/report');
  const main = page.getByRole('region', { name: 'Головне' });
  await expect(main).toContainText('1 з 3 доз у дні з записами');
  await expect(main).toContainText('Препарат Б — пропущено 1');
  await expect(main).toContainText('Без відмітки: 1 доз.');
  await expect(main).not.toContainText('Препарат В — пропущено');
  const text = await shareText(page);
  expect(text).toContain('Препарат Б — пропущено 1');
  expect(text).toContain('Без відмітки: 1 доз.');
  expect(text).not.toContain('Препарат В — пропущено');
  await page.emulateMedia({ media: 'print' });
  await expect(main.getByText('Препарат Б — пропущено 1', { exact: true })).toBeVisible();
  await expect(main.getByText('Без відмітки: 1 доз.', { exact: true })).toBeVisible();
});
