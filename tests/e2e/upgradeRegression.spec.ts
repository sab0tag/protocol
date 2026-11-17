import { expect, test } from '@playwright/test';
import { device, seed, ymd, kyivOffset } from './helpers';

test('an identical composition remains repeatable in each meal tile — «Як учора» (D159)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const date = ymd(yesterday), offset = kyivOffset(yesterday);
  const items = [{ foodId: 'kefir', name: 'Кефір 2,5 %', grams: 250 }];
  await seed(page, [
    { store: 'entries', value: { id: 'category-breakfast', kind: 'meal', status: 'done', at: `${date}T08:00:00${offset}`, title: 'Сніданок', items } },
    { store: 'entries', value: { id: 'category-snack', kind: 'meal', status: 'done', at: `${date}T16:00:00${offset}`, title: 'Перекус', items } },
  ]);
  const breakfast = page.locator('[data-testid=meal-tiles] [data-slot="0"]');
  await breakfast.getByRole('button', { name: /^Сніданок/ }).click();
  await expect(breakfast.getByRole('button', { name: 'Як учора: Кефір 2,5 %' })).toHaveCount(1);
  // D161: a snack is a new block of its own, opened with «Додати їжу → Перекус»
  await page.getByTestId('meal-tiles').getByRole('button', { name: 'Додати їжу', exact: true }).click();
  await page.getByRole('group', { name: 'Що це за прийом?' }).getByRole('button', { name: 'Перекус', exact: true }).click();
  const snack = page.locator('[data-testid=meal-tiles] [data-slot="3"]');
  await snack.getByRole('button', { name: 'Як учора: Кефір 2,5 %' }).click();
  await expect(snack.getByRole('list', { name: 'Перекус' })).toContainText('250 г');
  await page.context().close();
});

test('checkbox and switch visuals follow the explicit theme independently of the device', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await page.goto('./#/more/settings');
  const dark = page.getByRole('checkbox', { name: 'Темна тема', exact: true });
  const visuals: Record<string, { scheme: string; mark: string; fill: string; thumb: string }> = {};
  for (const system of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: system, reducedMotion: 'reduce' });
    for (const theme of ['dark', 'light'] as const) {
      await dark.setChecked(theme === 'dark');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const visual = await page.evaluate(async () => {
        const toggle = document.querySelector<HTMLInputElement>('.protocol-switch')!;
        // Compare settled paint rather than an intermediate CSS transition frame.
        getComputedStyle(toggle, '::after').backgroundColor;
        await Promise.all(toggle.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined)));
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = true;
        document.querySelector('main')!.append(input);
        const style = getComputedStyle(input);
        const mark = style.backgroundImage, fill = style.backgroundColor; input.remove();
        return { scheme: getComputedStyle(document.documentElement).colorScheme, mark, fill,
          thumb: getComputedStyle(toggle, '::after').backgroundColor };
      });
      visuals[`${system}:${theme}`] = visual;
      expect(visual.scheme).toBe(theme);
    }
  }
  expect(Object.keys(visuals)).toHaveLength(4);
  for (const theme of ['light', 'dark']) expect(visuals[`light:${theme}`]).toEqual(visuals[`dark:${theme}`]);
  await page.context().close();
});
