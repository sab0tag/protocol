import { expect, test } from '@playwright/test';
import { device, seed } from './helpers';
import { t } from '../../src/i18n/uk';

const tabsOf = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Розділи', exact: true });

test('three tabs, one «Ще» in the header; screens opened over a section have «Назад» and no tabs (ТЗ 17.11, step 2)', async ({ browser }) => {
  const page = await device(browser, 'skip');
  await seed(page, [{ store: 'entries', value: { id: 'shell-kept', kind: 'water', status: 'done', at: '2026-11-04T10:00:00+02:00', title: 'Synthetic water', waterMl: 250 } }]);
  const tabs = tabsOf(page);
  await expect(tabs.getByRole('link')).toHaveText(['Сьогодні', 'Мій план', 'Результати']);
  await expect(tabs.getByRole('link', { name: t.nav.day, exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.protocol-app-header')).toContainText('Протокол');
  await expect(page.locator('.protocol-app-header')).not.toContainText('2.0');
  await expect(page.getByRole('button', { name: /меню/i })).toHaveCount(0); // no drawer next to «Ще»
  const more = page.locator('.protocol-app-header').getByRole('link', { name: t.nav.more, exact: true });
  await more.click();
  await expect(page).toHaveURL(/#\/more$/);
  await expect(more).toHaveAttribute('aria-current', 'page');
  await expect(tabs).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: t.more.title })).toBeVisible();
  await expect(page.locator('main details, main summary')).toHaveCount(0); // one list, no categories
  await page.getByRole('link', { name: t.more.settings, exact: true }).click();
  await expect(page).toHaveURL(/#\/more\/settings$/);
  await expect(page.getByRole('link', { name: t.sync.title, exact: true })).toHaveAccessibleDescription(t.day.syncStatus.off);
  await page.getByRole('button', { name: t.shell.back, exact: true }).click();
  await expect(page).toHaveURL(/#\/more$/);
  await page.getByRole('button', { name: t.shell.back, exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(tabs.getByRole('link', { name: t.nav.day, exact: true })).toHaveAttribute('aria-current', 'page');

  // opened directly, «Назад» goes to the screen's section; the full meal form and a plan part show no tabs
  for (const [path, parent, tab] of [['/meal/new?slot=1', /#\/$/, t.nav.day], ['/plan/constraints', /#\/plan$/, t.nav.plan], ['/report', /#\/progress$/, t.nav.progress]] as const) {
    await page.goto(`./#${path}`); await page.reload();
    await expect(page.getByRole('button', { name: t.shell.back, exact: true })).toBeVisible();
    await expect(tabs).toHaveCount(0);
    await page.getByRole('button', { name: t.shell.back, exact: true }).click();
    await expect(page).toHaveURL(parent);
    await expect(tabs.getByRole('link', { name: tab, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  const record = await page.evaluate(async () => {
    const open = indexedDB.open('protocol'); await new Promise(resolve => { open.onsuccess = resolve; });
    const request = open.result.transaction('entries').objectStore('entries').get('shell-kept');
    const row = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); }); open.result.close(); return row;
  });
  expect(record).toEqual(expect.objectContaining({ id: 'shell-kept', waterMl: 250, status: 'done' }));
  await page.context().close();
});

test('the first «Знайомство» has no tabs, no «Назад» and no «Ще»', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(tabsOf(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: t.shell.back, exact: true })).toHaveCount(0);
  await expect(page.locator('.protocol-app-header').getByRole('link', { name: t.nav.more, exact: true })).toHaveCount(0);
});

test('shell fits all approved widths and themes, bundles Ukrainian fonts and keeps navigation operable offline', async ({ browser }) => {
  const page = await device(browser, 'skip');
  for (const scheme of ['light', 'dark'] as const) for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.protocol-app-header').getByRole('link', { name: t.nav.more, exact: true })).toBeVisible();
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
    // measured once the layout has settled at the new width (crossing the md breakpoint reflows the bar into a rail)
    await expect(async () => {
      for (const link of await page.getByRole('navigation', { name: 'Розділи', exact: true }).getByRole('link').all()) {
        const box = await link.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }).toPass({ timeout: 5_000 });
    await page.screenshot({ path: `test-results/mockup-shell-${width}-${scheme}.png`, fullPage: true });
  }
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Inter');
  await page.context().setOffline(true); await page.reload();
  await page.getByRole('navigation', { name: 'Розділи', exact: true }).getByRole('link', { name: t.nav.plan, exact: true }).click();
  await expect(page).toHaveURL(/#\/plan$/);
  await page.locator('.protocol-app-header').getByRole('link', { name: t.nav.more, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: t.more.title })).toBeVisible();
  await page.screenshot({ path: 'test-results/mockup-shell-more-dark.png' });
  await page.context().close();
});

test('«Ще» respects disabled modules while plan and recovery remain available', async ({ browser }) => {
  test.skip(process.env.VITE_MODULE_POLICY_ENABLED !== 'true', 'acceptance build');
  const page = await device(browser, 'skip');
  const at = new Date().toISOString();
  await seed(page, ['food', 'menu', 'assistant', 'workout', 'progress', 'water', 'wellbeing'].map(module => ({ store: 'moduleEvents', value: {
    id: `shell-off-${module}`, v: 1, kind: 'module', module, enabled: false, source: 'manual', at,
  } })));
  await page.locator('.protocol-app-header').getByRole('link', { name: t.nav.more, exact: true }).click();
  for (const name of [t.assistant.title, t.menu.quick, t.well.title, t.workout.title, t.dishes.title, t.conciergeLog.link]) {
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
  }
  await page.getByRole('link', { name: t.more.settings, exact: true }).click();
  await page.getByRole('link', { name: t.sync.title, exact: true }).click();
  await expect(page).toHaveURL(/#\/sync$/);
  await page.goto('./#/plan');
  await expect(tabsOf(page).getByRole('link', { name: t.nav.plan, exact: true })).toHaveAttribute('aria-current', 'page');
  await page.context().close();
});
