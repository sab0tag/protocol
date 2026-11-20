import { expect, test, type Page } from '@playwright/test';
import { device, seed, toast, ymd } from './helpers';
import { emptyPlan } from '../../src/data/seed.example';
import { t } from '../../src/i18n/uk';

// D191 («Очередь агента», задача 13.1): «Запитати лікаря» — a phrase in the one field goes on the doctor's list after «Додати»;
// 0–3 days before the visit the list is on «Сьогодні»; after it — «Спитав» and the answer in one line.

const field = (page: Page) => page.getByTestId('one-input').getByRole('textbox', { name: 'Скажіть або напишіть…' });
const day = (n: number) => ymd(new Date(Date.now() + n * 86_400_000));

test('the one field: «запитати лікаря, …» → «Додати» → on the list in «Що сказав лікар», and on «Сьогодні» before the visit', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [{ store: 'plan', value: { ...emptyPlan(), id: 'main', onboardedAt: day(-5), nextCheckup: { date: day(2), tests: [] } } }]);
  await page.goto('./#/');
  await field(page).fill('запитати лікаря, чи можна каву з Омепразолом');
  await field(page).press('Enter');
  const card = page.getByRole('group', { name: t.ask.oneField('Чи можна каву з Омепразолом?') });
  await card.getByRole('button', { name: t.ask.yes }).click();
  await expect(toast(page)).toContainText(t.ask.added);
  await expect(page.getByTestId('questions-soon')).toContainText(t.ask.soon(2));
  await expect(page.getByTestId('questions-soon')).toContainText('Чи можна каву з Омепразолом?');
  await page.goto('./#/plan');
  await expect(page.getByTestId('doctor-questions')).toContainText('Чи можна каву з Омепразолом?');
  await expect(page.getByTestId('doctor-questions').getByRole('button', { name: t.ask.asked })).toHaveCount(0); // before the visit
});

test('after the visit: «Спитав» and the answer in one line — the question moves to the answers', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [{ store: 'plan', value: { ...emptyPlan(), id: 'main', onboardedAt: day(-10), nextCheckup: { date: day(-1), tests: [] }, questions: ['Чи можна плавати?'] } }]);
  await page.goto('./#/plan');
  const box = page.getByTestId('doctor-questions');
  await box.getByRole('button', { name: t.ask.asked }).click();
  await box.getByPlaceholder(t.ask.answer).fill('так, з третього тижня');
  await box.getByRole('button', { name: t.ask.save }).click();
  await expect(box).toContainText(t.ask.answered);
  await expect(box).toContainText('Чи можна плавати? — так, з третього тижня');
  await expect(box.getByRole('button', { name: t.ask.asked })).toHaveCount(0);
});
