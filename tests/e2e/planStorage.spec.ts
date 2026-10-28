import { expect, test } from '@playwright/test';
import { V10_STORES } from '../fixtures/schemaV10';
import { emptyPlan } from '../../src/data/seed.example';
import { ymd } from './helpers';

// A native v10 database, not a current Dexie instance pretending to be an older schema.
test('app opens an existing v10 journal without losing local data or enabling prepared plans', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const original = { ...emptyPlan(), id: 'main', onboardedAt: ymd(new Date()), questions: ['Synthetic retained question'] };
  const draft = { id: 'plan-review', v: 1, revision: 'synthetic-v10', at: new Date().toISOString(),
    source: 'Synthetic local review', note: '', cuts: {}, lines: [{ key: 'note', kind: 'unread', status: 'unread', text: 'Synthetic source fragment' }] };
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';
  await page.addInitScript(({ stores, plan, draft, photo }) => {
    // Issued before the app's module executes; its upgrade request queues after this native transaction.
    const req = indexedDB.open('protocol', 100);
    req.onupgradeneeded = () => {
      for (const [table, schema] of Object.entries(stores)) {
        const [primary, ...indexes] = schema.split(',').map(s => s.trim());
        const store = req.result.createObjectStore(table, { keyPath: primary!.startsWith('[') ? primary!.slice(1, -1).split('+') : primary! });
        indexes.forEach(index => store.createIndex(index, index));
      }
      req.transaction!.objectStore('plan').put(plan);
      req.transaction!.objectStore('profile').put({ key: 'self', jpeg: photo });
      req.transaction!.objectStore('reviewDrafts').put(draft);
      req.transaction!.objectStore('weights').put({ date: '2026-10-20', kg: 90 });
    };
    req.onsuccess = () => req.result.close();
  }, { stores: V10_STORES, plan: original, draft, photo });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Сьогодні', exact: true, level: 1 })).toBeVisible();
  const stored = await page.evaluate(async () => {
    const req = indexedDB.open('protocol'); await new Promise<void>((resolve, reject) => { req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); });
    try {
      const tx = req.result.transaction(['plan', 'profile', 'reviewDrafts', 'weights', 'carePlans', 'carePlanItems', 'planMigrations']);
      const read = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      return { version: req.result.version, plan: await read(tx.objectStore('plan').get('main')),
        photo: await read(tx.objectStore('profile').get('self')), draft: await read(tx.objectStore('reviewDrafts').get('plan-review')),
        weights: await read(tx.objectStore('weights').getAll()), plans: await read(tx.objectStore('carePlans').count()),
        items: await read(tx.objectStore('carePlanItems').count()), migrations: await read(tx.objectStore('planMigrations').count()) };
    } finally { req.result.close(); }
  });
  expect(stored.version).toBe(110);
  expect(stored.plan).toEqual(original); expect(stored.photo).toEqual({ key: 'self', jpeg: photo }); expect(stored.draft).toEqual(draft);
  expect(stored.weights).toEqual([{ date: '2026-10-20', kg: 90 }]);
  expect([stored.plans, stored.items, stored.migrations]).toEqual([0, 0, 0]);
  await page.goto('./#/plan/scan');
  await expect(page.getByRole('region', { name: 'Незавершена перевірка', exact: true })).toBeVisible();
  await context.close();
});
