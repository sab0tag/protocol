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
  await page.getByRole('checkbox', { name: /Я погоджуюсь передати/ }).check();
  await page.getByRole('button', { name: 'Передати звіт', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-shared-report', /Звіт за/);
  return (await page.locator('body').getAttribute('data-shared-report'))!;
}

test('water alone leaves medicine data absent, not skipped, in the report, print and shared text', async ({ browser }) => {
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
  await expect(main).toContainText('Дані відсутні: 1 доз.');
  await expect(main).not.toContainText('пропущено');
  await expect(main).toContainText('Дні без записів не оцінюються');
  const text = await shareText(page);
  expect(text).toContain('Дані відсутні: 1 доз.');
  expect(text).not.toContain('пропущено');
  await page.emulateMedia({ media: 'print' });
  await expect(main.getByText('Дані відсутні: 1 доз.', { exact: true })).toBeVisible();
  await expect(main).not.toContainText('пропущено');
});

test('several medicines retain explicit skip, completion, and missing data as separate outcomes', async ({ browser }) => {
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
  await expect(main).toContainText('Дані відсутні: 1 доз.');
  await expect(main).not.toContainText('Препарат В — пропущено');
  const text = await shareText(page);
  expect(text).toContain('Препарат Б — пропущено 1');
  expect(text).toContain('Дані відсутні: 1 доз.');
  expect(text).not.toContain('Препарат В — пропущено');
  await page.emulateMedia({ media: 'print' });
  await expect(main.getByText('Препарат Б — пропущено 1', { exact: true })).toBeVisible();
  await expect(main.getByText('Дані відсутні: 1 доз.', { exact: true })).toBeVisible();
});

test('the report separates late completion, uncertainty, explicit skip, and no data', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.clock.setFixedTime(new Date('2026-10-28T12:00:00+02:00'));
  const records = [
    { id: 'late', at: `${date}T09:10:00+02:00`, kind: 'med', status: 'done', adherence: 'completed_late', title: 'Пізно',
      checkKey: 'med:late:08:30', prescriptionId: 'late' },
    { id: 'uncertain', at: `${date}T08:30:00+02:00`, kind: 'med', status: 'planned', adherence: 'uncertain',
      markedAt: `${date}T12:00:00+02:00`, title: 'Не впевнені', checkKey: 'med:uncertain:08:30', prescriptionId: 'uncertain' },
    { id: 'skipped', at: `${date}T08:30:00+02:00`, kind: 'med', status: 'skipped', title: 'Пропущено',
      checkKey: 'med:skipped:08:30', prescriptionId: 'skipped' },
    { id: 'completed', at: `${date}T08:20:00+02:00`, kind: 'med', status: 'done', title: 'Виконано',
      checkKey: 'med:completed:08:30', prescriptionId: 'completed' },
  ];
  await seed(page, [
    { store: 'plan', value: { id: 'main', onboardedAt: date, lastVisit: date, constraints: [], targets: {}, modes: [],
      prescriptions: ['late', 'uncertain', 'skipped', 'completed', 'no-data'].map((id) => prescription(id, id)) } },
    { store: 'entries', value: water },
    ...records.map((value) => ({ store: 'entries', value })),
  ]);
  await page.goto('./#/report');
  const main = page.getByRole('region', { name: 'Головне' });
  await expect(main).toContainText('2 з 5 доз у дні з записами');
  await expect(main).toContainText('Пізно виконано: 1 доз.');
  await expect(main).toContainText('Не впевнені, чи прийнято: 1 доз.');
  await expect(main).toContainText('Дані відсутні: 1 доз.');
  await expect(main).toContainText('skipped — пропущено 1');
  await expect(main).not.toContainText('uncertain — пропущено');
  await expect(main).not.toContainText('no-data — пропущено');
});
