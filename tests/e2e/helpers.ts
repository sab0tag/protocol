import { expect, type Browser, type Page } from '@playwright/test';
import { examplePlan } from '../../src/data/seed.example';

/** A fresh «device»: the app loaded, its service worker settled (unless `sw: false`), then — `example`: the example plan put into the own
 *  database on a clean history (a fixture); `demo`: «Подивитись на прикладі», the example's own database (D98); `skip`: nothing. */
export async function device(browser: Browser, start: 'example' | 'demo' | 'skip' = 'example', opts: { sw?: boolean } = {}): Promise<Page> {
  // `sw: false` — no service worker. For tests that stub the network: requests the worker sends can pass Playwright's
  // routing (page and context alike) and reach the real e2e server, which has no AI key — an intermittent «ІІ вимкнений».
  const sw = opts.sw ?? true;
  const ctx = await browser.newContext(sw ? {} : { serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto('./');
  if (sw) await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(500);
  if (start === 'demo') { // D98: the example's own database, opened as a person opens it
    await page.getByRole('button', { name: 'Подивитись на прикладі' }).click();
    await expect(page.getByText(/Це приклад:/)).toBeVisible();
    return page;
  }
  await page.getByRole('button', { name: /^Пропустити/ }).click();
  await expect(page).toHaveURL(/#\/$/); // D113: the first screen is the photo
  if (start === 'example') { // the example plan in the person's own database, on a clean history — a fixture for the tests
    await page.evaluate(async (plan) => {
      const req = indexedDB.open('protocol');
      await new Promise((r) => { req.onsuccess = r; });
      const tx = req.result.transaction('plan', 'readwrite');
      const store = tx.objectStore('plan');
      const get = store.get('main');
      await new Promise((r) => { get.onsuccess = r; });
      store.put({ ...get.result, ...plan, id: 'main' });
      await new Promise((r) => { tx.oncomplete = r; });
      // D120: the plan is weeks old — «Допомогти пілоту?» would come up on «День» a moment later and move what a test taps;
      // a fixture says «Ні» twice for it (the offer has its own tests in pilot.spec)
      const p = req.result.transaction('pilot', 'readwrite');
      p.objectStore('pilot').put({ key: 'pilot', asked: [{ at: '2026-01-01', answer: 'no' }, { at: '2026-02-01', answer: 'no' }] });
      await new Promise((r) => { p.oncomplete = r; });
      // A general UI fixture models an existing all-module profile, independently of the new clean-start policy.
      // Actual onboarding acceptance starts with a fresh page and exercises its own confirmed choices.
      const modules = req.result.transaction('moduleEvents', 'readwrite'), history = modules.objectStore('moduleEvents');
      history.clear();
      for (const module of ['meds', 'water', 'food', 'menu', 'assistant', 'wellbeing', 'workout', 'progress']) history.put({
        id: `fixture-module-${module}`, v: 1, at: '2026-01-01T00:00:00.000Z', kind: 'module', module, enabled: true,
        source: 'migration', reason: 'compatibility', before: 'unknown' });
      history.put({ id: 'fixture-initialised', v: 1, at: '2026-01-01T00:00:00.000Z', kind: 'initialised' });
      await new Promise((r) => { modules.oncomplete = r; });
      req.result.close();
    }, examplePlan());
    await page.reload();
    await page.waitForTimeout(300);
  }
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
/** A skipped onboarding records its own clean-start module choices (D138); a test that seeds its own history clears them first. */
export async function clearModules(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const open = indexedDB.open('protocol'); await new Promise((r) => { open.onsuccess = r; });
    const tx = open.result.transaction('moduleEvents', 'readwrite'); tx.objectStore('moduleEvents').clear();
    await new Promise((r) => { tx.oncomplete = r; }); open.result.close();
  });
}

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

/** The offset of Europe/Kyiv at a moment — «+03:00» in summer, «+02:00» in winter (a test hard-coding «+03:00» broke on the
 *  day the clocks went back, 25.10.2026). */
export function kyivOffset(at: Date = new Date()): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')!.value;
  return name === 'GMT' ? '+00:00' : name.replace('GMT', '');
}
