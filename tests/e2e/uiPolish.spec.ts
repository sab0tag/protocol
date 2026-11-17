import { expect, test, type Page } from '@playwright/test';
import { device } from './helpers';

// UI-POLISH-01: the four redesigned tabs, checked together — keyboard focus, hit areas, widths and offline.
const tabs = [
  { path: '/', title: 'Сьогодні', heading: 'Сьогодні' },
  { path: '/plan', title: 'Мій план', heading: 'Мій план' },
  { path: '/progress', title: 'Результати', heading: 'Результати' },
  { path: '/more', title: 'Більше', heading: 'Додаткові можливості' },
];
const widths = [320, 375, 390, 430, 768, 1024, 1440];

/** Every control reached by Tab is on screen and shows where focus is. */
async function focusProblems(page: Page, path: string): Promise<string[]> {
  const out: string[] = [];
  await page.locator('body').focus();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return { name: (el.getAttribute('aria-label') || el.innerText || el.tagName).trim().slice(0, 40), w: r.width, h: r.height,
        on: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
        ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 || cs.boxShadow !== 'none' };
    });
    if (!f) break;
    if (!f.on || f.w === 0 || f.h === 0) out.push(`${path}: «${f.name}» focused off screen`);
    else if (!f.ring) out.push(`${path}: «${f.name}» has no focus indicator`);
  }
  return out;
}

/** Controls a finger has to hit: at least 44 × 44 px. Links inside running text are measured by their line, not here. */
async function smallTargets(page: Page, path: string): Promise<string[]> {
  return (await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a[href], main input:not([type=hidden]), main select, main summary, main [role=switch], nav button, nav a[href], header button, header a[href]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; })
    .filter((el) => !(el.tagName === 'A' && el.closest('p, li > span')))
    .filter((el) => { const r = el.getBoundingClientRect(); return Math.round(r.width) < 44 || Math.round(r.height) < 44; })
    .map((el) => { const r = el.getBoundingClientRect(); return `«${(el.getAttribute('aria-label') || el.innerText || el.tagName).trim().slice(0, 40)}» ${Math.round(r.width)}×${Math.round(r.height)}`; })))
    .map((s) => `${path}: ${s}`);
}

test('the four tabs keep visible keyboard focus and 44 px hit areas at every approved width', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await device(browser, 'demo'); // a filled synthetic profile, in a database of its own
  const problems: string[] = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const { path, heading } of tabs) {
      await page.goto('./#' + path);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), { message: `${path} overflows at ${width}px` }).toBeLessThanOrEqual(0);
      for (const p of await smallTargets(page, path)) problems.push(`${width}px ${p}`);
      if (width === 390 || width === 1440) for (const p of await focusProblems(page, path)) problems.push(`${width}px ${p}`);
    }
  }
  expect([...new Set(problems)]).toEqual([]);
  await page.context().close();
});

test('every tab opens offline after a reload', async ({ browser }) => {
  const page = await device(browser, 'demo');
  for (const { path } of tabs) { await page.goto('./#' + path); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); }
  await page.context().setOffline(true);
  await page.reload();
  const nav = page.getByRole('navigation', { name: 'Розділи', exact: true });
  for (const { path, title, heading } of tabs) {
    await nav.getByRole('link', { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${path === '/' ? '/?' : path}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
  }
  await page.context().close();
});
