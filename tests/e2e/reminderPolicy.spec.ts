import { expect, test } from '@playwright/test';
import { device, seed, syncOn } from './helpers';

test('the built service worker shares policy with the server and suppresses offline water without suppressing medicines', async ({ browser }) => {
  const page = await device(browser);
  await seed(page, [{ store: 'moduleEvents', value: { id: 'water-off', v: 1, kind: 'module', module: 'water', source: 'manual', enabled: false,
    at: '2026-01-01T00:00:00.000Z' } }]);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const context = page.context();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await expect.poll(async () => worker.evaluate(() => typeof (self as unknown as { ProtocolReminderPolicy?: { reminderAllowed?: unknown } }).ProtocolReminderPolicy?.reminderAllowed)).toBe('function');
  expect(await worker.evaluate(() => (self as unknown as { PROTOCOL_MODULE_POLICY_ENABLED: boolean }).PROTOCOL_MODULE_POLICY_ENABLED))
    .toBe(process.env.VITE_MODULE_POLICY_ENABLED === 'true');
  await context.setOffline(true);
  // Dispatch the real registered handler, await its waitUntil promise, and capture notification API calls.
  // This checks browser IDB/compiled scripts without depending on OS/DevTools push delivery in headless Chromium.
  const shown = await worker.evaluate(async () => {
    const out: { title: string; body: string }[] = [];
    Object.defineProperty(self.registration, 'showNotification', { configurable: true,
      value: async (title: string, options: { body: string }) => { out.push({ title, body: options.body }); } });
    const push = async (payload: object) => {
      const waits: Promise<unknown>[] = [], event = new Event('push');
      Object.defineProperties(event, { data: { value: { json: () => ({ t: 'Reminder', b: 'Generic', a: Date.now(), pv: 1, ...payload }) } },
        waitUntil: { value: (p: Promise<unknown>) => waits.push(p) } });
      self.dispatchEvent(event);
      await Promise.all(waits);
    };
    await push({ k: 'water', pa: { water: true } }); // stale server permission cannot override local offline off
    await push({ k: 'med', h: '08:30', n: 1 });
    return out;
  });
  expect(shown).toHaveLength(1);
  expect(shown[0]?.title).toContain('Ще раз');
  expect(shown[0]?.body).toContain('Вітамін D');
});

test('offline policy stays pending and is reconciled on reconnect even on a device without push', async ({ browser }) => {
  test.skip(process.env.VITE_MODULE_POLICY_ENABLED !== 'true', 'new protocol is enabled only in the acceptance build');
  const page = await device(browser);
  await syncOn(page);
  const state = () => page.evaluate(async () => {
    const open = indexedDB.open('protocol');
    await new Promise((r) => { open.onsuccess = r; });
    const req = open.result.transaction('meta', 'readonly').objectStore('meta').get('sync');
    await new Promise((r) => { req.onsuccess = r; });
    open.result.close();
    const row = req.result;
    return { state: row.reminderPolicyState, water: row.reminderPolicyAck ? JSON.parse(row.reminderPolicyAck).modules.water?.enabled : undefined,
      device: row.device };
  });
  await expect.poll(async () => (await state()).state).toBe('synced');
  expect((await state()).device).toBeUndefined();
  await page.context().setOffline(true);
  await seed(page, [{ store: 'moduleEvents', value: { id: 'offline-off', v: 1, kind: 'module', module: 'water', source: 'manual', enabled: false,
    at: '2026-01-01T00:00:00.000Z' } }]);
  await expect.poll(async () => (await state()).state).toBe('pending');
  expect((await state()).water).toBe(true); // only the old state is acknowledged
  await page.context().setOffline(false);
  await expect.poll(state).toMatchObject({ state: 'synced', water: false });
});
