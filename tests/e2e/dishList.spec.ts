import { expect, test, type Page } from '@playwright/test';
import { device, toast } from './helpers';

const LIST = `Сирники домашні — сир 5 % 400 г, 2 яйця, борошно 3 ст. л., на пательні, на 4 порції
сирники  домашні — сир 5 % 400 г, 2 яйця, борошно 3 ст. л., на пательні, на 4 порції
Борщ
Гречка з опеньками: гречка, опеньки, цибуля, олія
Пиріг бабусин`;

/** The model's answer, faked: the e2e server has no AI key; what is checked is the app — what goes, how much, what it does. */
async function fakeModel(page: Page) {
  const asked: { dishes: { key: string; text: string }[] }[] = [];
  await page.context().route('**/v1/device/dishes', async (route) => { // the context's: a request through the service worker too
    const body = route.request().postDataJSON() as { dishes: { key: string; text: string }[] };
    asked.push(body);
    await route.fulfill({ json: { dishes: body.dishes.map((d) => ({ key: d.key, readable: true, name: d.text.split(/[:—]/)[0]!.trim(), portions: 2, note: '',
      items: [
        { said: 'гречка', base: 'Гречка варена', grams: 300, amountSaid: false, kcal: 0, protein: 0, fat: 0, carbs: 0, tags: [], allergens: [] },
        { said: 'опеньки', base: '', grams: 200, amountSaid: false, kcal: 22, protein: 2.2, fat: 1.2, carbs: 0.5, tags: [], allergens: [] },
      ] })) } });
  });
  return asked;
}
const openList = async (page: Page) => {
  await page.goto('./#/dishes');
  await page.getByRole('button', { name: 'Додати списком' }).click();
};

test('a list: the repeat merged, «вже є», one made here, a name alone a draft — exactly one request to the model (D123)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const asked = await fakeModel(page);
  await openList(page);
  await page.getByRole('region', { name: 'Додати страви списком' }).getByRole('textbox').fill(LIST);
  await page.getByRole('button', { name: 'Прочитати список' }).click();
  await expect(page.getByTestId('list-summary')).toHaveText('4 страви: 1 вже є, 1 без ІІ, 1 без складу, 1 підуть до ІІ (1 запит)');
  await expect(page.getByText('Повтори склеєно: 1')).toBeVisible();
  await expect(page.locator('[data-dish="Сирники домашні"]')).toHaveAttribute('data-status', 'ok');
  await expect(page.locator('[data-dish="Борщ"]')).toContainText('Вже є серед страв застосунку');
  await expect(page.locator('[data-dish="Пиріг бабусин"]')).toContainText('Потрібен склад');
  await page.getByRole('button', { name: 'Розкласти', exact: true }).click();
  await page.getByRole('button', { name: 'Дозволити й розкласти' }).click();
  await expect(page.locator('[data-dish="Гречка з опеньками"]')).toHaveAttribute('data-status', 'check');
  expect(asked).toHaveLength(1);
  expect(asked[0]!.dishes.map((d) => d.text)).toEqual(['Гречка з опеньками — гречка, опеньки, цибуля, олія']); // the summary was what went
  // the unsaved list survives a reload
  await page.reload();
  await page.goto('./#/dishes');
  await expect(page.locator('[data-dish="Гречка з опеньками"]')).toHaveAttribute('data-status', 'check');
  // «Зберегти всі з ✓» takes the ✓ one only; a «?» is saved on its own, opened
  await page.getByRole('button', { name: 'Зберегти всі з ✓ (1)' }).click();
  await expect(toast(page)).toContainText('Додано страв: 1');
  await expect(page.locator('[data-dish="Сирники домашні"]')).toHaveAttribute('data-status', 'saved');
  await expect(page.locator('[data-dish="Гречка з опеньками"]')).toHaveAttribute('data-status', 'check');
  await page.locator('[data-dish="Гречка з опеньками"]').getByRole('button', { name: /Гречка з опеньками, перевірте/ }).click();
  await page.locator('[data-dish="Гречка з опеньками"]').getByRole('button', { name: 'Зберегти цю страву' }).click();
  // the draft: a name, no numbers; its make-up typed on the card is read here, no request
  await page.getByRole('button', { name: 'Зберегти заготовки без складу (1)' }).click();
  await page.getByRole('button', { name: 'Закрити список' }).click();
  await expect(page.getByText('Потрібен склад — без нього страви немає в пошуку їжі')).toBeVisible();
  expect(asked).toHaveLength(1);
  // drafts are not in the meal search
  await page.goto('./#/meal/new');
  await page.getByRole('searchbox').fill('Пиріг бабусин');
  await expect(page.getByText('«Пиріг бабусин» — не знайдено — додайте вручну')).toBeVisible();
});

test('export → import on a clean phone: the same dishes, the same numbers, no request to the model (D123)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await openList(page);
  await page.getByRole('region', { name: 'Додати страви списком' }).getByRole('textbox').fill('Сирники домашні — сир 5 % 400 г, 2 яйця, борошно 3 ст. л., на 4 порції\nЯйця на олії - 2 яйця, олія 5 г\nЛаваш-рол');
  await page.getByRole('button', { name: 'Прочитати список' }).click();
  await page.getByRole('button', { name: 'Зберегти всі з ✓ (2)' }).click();
  await page.getByRole('button', { name: 'Зберегти заготовки без складу (1)' }).click();
  await page.getByRole('button', { name: 'Закрити список' }).click();
  const kcal = async (p: Page, name: string) => (await p.locator('li').filter({ has: p.locator(`input[value="${name}"]`) }).getByText(/на 1 порцію: ≈/).innerText());
  const before = [await kcal(page, 'Сирники домашні'), await kcal(page, 'Яйця на олії')];
  await page.getByRole('button', { name: 'Експортувати' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Зберегти файл' }).click()]);
  const path = await download.path();

  const other = await device(browser, 'skip');
  const calls: string[] = [];
  other.context().on('request', (r) => { if (r.url().includes('/dishes')) calls.push(r.url()); });
  await openList(other);
  await other.getByLabel('Вибрати файл').setInputFiles(path);
  await expect(other.getByText('З файла експорту: 3 — ті самі цифри, без ІІ')).toBeVisible();
  await other.getByRole('button', { name: 'Зберегти всі з ✓ (2)' }).click();
  await other.getByRole('button', { name: 'Зберегти заготовки без складу (1)' }).click();
  await other.getByRole('button', { name: 'Закрити список' }).click();
  expect([await kcal(other, 'Сирники домашні'), await kcal(other, 'Яйця на олії')]).toEqual(before);
  await expect(other.getByText('Потрібен склад — без нього страви немає в пошуку їжі')).toBeVisible();
  expect(calls).toEqual([]);
});

test('a .csv saved by Excel on Windows (Windows-1251) is read (D123)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await openList(page);
  await page.getByLabel('Вибрати файл').setInputFiles('tests/fixtures/dishes-cp1251.csv');
  await expect(page.getByTestId('list-summary')).toContainText('5 страв:');
  await expect(page.locator('[data-dish="Вареники з картоплею"]')).toBeVisible();
  await expect(page.locator('[data-dish="Олів’є"]')).toBeVisible();
});

test('a file with a negative energy or a word for a number: refused and said, never «−100 ккал ✓» (D131)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await openList(page);
  const bad = { format: 'protocol-dishes', v: 1, dishes: [
    { name: 'Мінус', items: [{ name: 'Щось', grams: 100, manual: { kcal: -100, protein: 1, fat: 1, carbs: 1 } }] },
    { name: 'Текст', items: [{ name: 'Щось', grams: 100, manual: { kcal: 100, protein: 'багато', fat: 1, carbs: 1 } }] },
    { name: 'Сир домашній', items: [{ name: 'Сир', grams: 100, manual: { kcal: 160, protein: 17, fat: 9, carbs: 2, calciumMg: 100 } }] }] };
  await page.getByLabel('Вибрати файл').setInputFiles({ name: 'd.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await expect(page.locator('[data-dish="Мінус"]')).toContainText('Не імпортовано');
  await expect(page.locator('[data-dish="Текст"]')).toContainText('не числа');
  await expect(page.locator('[data-dish="Сир домашній"]')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByText(/−100|NaN/)).toHaveCount(0);
});
