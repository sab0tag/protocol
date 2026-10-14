import { expect, type Browser, type Page } from '@playwright/test';

/** A fresh «device»: the app loaded, its service worker settled, the example plan opened (D73) — or onboarding skipped. */
export async function device(browser: Browser, start: 'example' | 'skip' = 'example'): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: start === 'example' ? 'Подивитись на прикладі' : /^Пропустити/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(/Знайомство|Про себе/);
  return page;
}

export async function syncOn(page: Page): Promise<void> {
  await page.goto('./#/sync');
  await page.getByRole('button', { name: 'Увімкнути на цьому пристрої' }).click();
  await page.getByRole('button', { name: 'Код записав — увімкнути' }).click();
  await expect(page.getByText(/Востаннє/)).toBeVisible();
}

export const toast = (page: Page) => page.locator('[role=status][aria-live=polite]');

export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Write rows straight into IndexedDB (bypassing the app), then reload so the app's query cache sees them. */
export async function seed(page: Page, rows: { store: string; value: unknown }[]): Promise<void> {
  await page.evaluate(async (rs) => {
    const req = indexedDB.open('protocol');
    await new Promise((r) => { req.onsuccess = r; });
    const tx = req.result.transaction([...new Set(rs.map((r) => r.store))], 'readwrite');
    for (const r of rs) tx.objectStore(r.store).put(r.value);
    await new Promise((r) => { tx.oncomplete = r; });
    req.result.close();
  }, rows);
  await page.reload();
  await page.waitForTimeout(500);
}
