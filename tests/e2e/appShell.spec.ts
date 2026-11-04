import { expect, test } from '@playwright/test';
import { device, seed } from './helpers';
import { t } from '../../src/i18n/uk';

test('four primary destinations retain food access, modal focus and existing records', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [{ store: 'entries', value: { id: 'shell-kept', kind: 'water', status: 'done', at: '2026-11-04T10:00:00+02:00', title: 'Synthetic water', waterMl: 250 } }]);
  const tabs = page.getByRole('navigation', { name: 'Розділи', exact: true });
  await expect(tabs.getByRole('link')).toHaveText(['Сьогодні', 'Мій план', 'Результати', 'Більше']);
  const opener = page.getByRole('button', { name: t.shell.openMenu });
  await opener.click();
  const menu = page.getByRole('dialog', { name: t.shell.menu });
  await expect(menu).toBeVisible();
  await expect(page.locator('.protocol-app-header button')).toHaveAttribute('aria-expanded', 'true');
  expect(await page.locator('.protocol-app-content').evaluate(el => el.inert)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0); await expect(opener).toBeFocused();
  await opener.click();
  await menu.locator('summary').filter({ hasText: t.more.food }).click();
  await menu.getByRole('link', { name: t.nutrition.title, exact: true }).click();
  await expect(page).toHaveURL(/#\/food$/); await expect(menu).toHaveCount(0);
  await expect(tabs.getByRole('link', { name: t.nav.more, exact: true })).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.nutrition.title);
  const record = await page.evaluate(async () => {
    const open = indexedDB.open('protocol'); await new Promise(resolve => { open.onsuccess = resolve; });
    const request = open.result.transaction('entries').objectStore('entries').get('shell-kept');
    const row = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); }); open.result.close(); return row;
  });
  expect(record).toEqual(expect.objectContaining({ id: 'shell-kept', waterMl: 250, status: 'done' }));
  await page.context().close();
});

test('shell fits all approved widths and themes, bundles Ukrainian fonts and keeps navigation operable offline', async ({ browser }) => {
  const page = await device(browser, 'skip');
  for (const scheme of ['light', 'dark'] as const) for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: t.shell.openMenu })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const contrast = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const luminance = (name: string) => style.getPropertyValue(`--${name}`).trim().split(/\s+/).map(Number)
        .map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
        .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i]!, 0);
      return [['ink', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['on-accent', 'accent'],
        ['warn', 'warn-bg'], ['ok', 'ok-bg'], ['danger', 'danger-bg'], ['pending', 'pending-bg'], ['moved', 'moved-bg']]
        .map(([a, b]) => { const light = [luminance(a!), luminance(b!)].sort((x, y) => x - y); return (light[1]! + .05) / (light[0]! + .05); });
    });
    for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
    for (const link of await page.getByRole('navigation', { name: 'Розділи', exact: true }).getByRole('link').all()) {
      const box = await link.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `test-results/mockup-shell-${width}-${scheme}.png`, fullPage: true });
  }
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Inter');
  await page.context().setOffline(true); await page.reload();
  await page.getByRole('navigation', { name: 'Розділи', exact: true }).getByRole('link', { name: t.nav.plan, exact: true }).click();
  await expect(page).toHaveURL(/#\/plan$/);
  await page.getByRole('button', { name: t.shell.openMenu }).click();
  await expect(page.getByRole('dialog', { name: t.shell.menu })).toBeVisible();
  await page.screenshot({ path: 'test-results/mockup-shell-drawer-dark.png' });
  await page.context().close();
});

test('drawer respects disabled modules while plan and recovery remain available', async ({ browser }) => {
  test.skip(process.env.VITE_MODULE_POLICY_ENABLED !== 'true', 'acceptance build');
  const page = await device(browser, 'skip');
  const at = new Date().toISOString();
  await seed(page, ['food', 'menu', 'assistant', 'workout', 'progress', 'water', 'wellbeing'].map(module => ({ store: 'moduleEvents', value: {
    id: `shell-off-${module}`, v: 1, kind: 'module', module, enabled: false, source: 'manual', at,
  } })));
  await page.getByRole('button', { name: t.shell.openMenu }).click();
  const menu = page.getByRole('dialog', { name: t.shell.menu });
  await expect(menu.locator('summary').filter({ hasText: t.more.food })).toHaveCount(0);
  await menu.locator('summary').filter({ hasText: t.more.settings }).click();
  await expect(menu.getByRole('link', { name: t.sync.title, exact: true })).toBeVisible();
  await menu.getByRole('link', { name: t.sync.title, exact: true }).click();
  await expect(page).toHaveURL(/#\/sync$/);
  await page.getByRole('navigation', { name: 'Розділи', exact: true }).getByRole('link', { name: t.nav.plan, exact: true }).click();
  await expect(page).toHaveURL(/#\/plan$/);
  await page.context().close();
});
