// Real application runner + real browser IndexedDB + local vault API. Only synthetic fixture data.
import 'fake-indexeddb/auto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ProtocolDB } from '../../src/data/db';
import { exportAll } from '../../src/data/backup';
import { emptyPlan } from '../../src/data/seed.example';
import { saveClinicImport } from '../../src/data/carePlans';
import { previewClinicPlan, confirmImport } from '../../src/domain/planImport';
import { deriveKeys, newCode, parseCode } from '../../src/sync/crypto';
import { captureSourcePlanCatalog, encryptSourcePlanCatalog } from '../../src/sync/sourcePlans';
import { prepareSourcePlanSend } from '../../src/sync/sourcePlanDelivery';
import { t } from '../../src/i18n/uk';
import { device, seed } from './helpers';

async function fixture(request: APIRequestContext, state: 'accepted' | 'conflict' | 'empty') {
  const code = newCode(), keys = await deriveKeys(parseCode(code)!), db = new ProtocolDB('protocol');
  const root = `http://localhost:8099/v1/vaults/${keys.vaultId}`, headers = { Authorization: `Bearer ${keys.auth}` };
  try {
    await db.meta.put({ key: 'sync', code, seq: 77 });
    await db.plan.put({ ...emptyPlan(), id: 'main', onboardedAt: '2026-10-30', questions: ['Синтетичний локальний журнал'] });
    const preview = previewClinicPlan({ schemaVersion: 1, planId: 'synthetic-runtime', organizationId: 'synthetic-clinic', issuedAt: '2026-10-30T10:00:00Z',
      clinician: { displayName: 'Тестовий лікар', organizationName: 'Тестова клініка' }, title: 'Підготовлена версія плану',
      medications: [{ name: 'Тестова інструкція', dose: '1 умовна одиниця', frequency: 'Текст джерела', duration: 'Тестовий період', instructions: 'Синтетичний текст для перевірки збереження оригіналу' }], restrictions: [], tests: [] })!;
    await saveClinicImport(db, 'main', confirmImport(preview, ['med:0'], 'main')!);
    const catalog = await captureSourcePlanCatalog(db), pending = await prepareSourcePlanSend(db, keys, 0);
    await db.carePlans.update(catalog.plans[0]!.id, { title: 'Нові локальні зміни плану' });
    expect((await request.put(root, { headers })).ok()).toBe(true);
    expect((await request.put(`${root}/write-protocol/conditional-records`, { headers, data: { minimum: 2, protocol: 2, condition: 'vault-seq' } })).ok()).toBe(true);
    if (state !== 'empty') {
      const remote = structuredClone(catalog); remote.plans[0]!.title = 'Версія плану з іншого пристрою';
      const record = state === 'accepted' ? pending.record : await encryptSourcePlanCatalog(keys, remote);
      expect((await request.post(`${root}/records/conditional`, { headers, data: { records: [record], protocol: 2, expectedSeq: 0 } })).ok()).toBe(true);
    }
    const rows: { store: string; value: unknown }[] = [{ store: 'meta', value: await db.meta.get('sync') }, { store: 'plan', value: await db.plan.get('main') }];
    for (const store of ['carePlans', 'carePlanItems', 'planMigrations'] as const) for (const value of await db[store].toArray()) rows.push({ store, value });
    return { root, headers, pending, rows, file: await exportAll(db) };
  } finally { await db.delete(); }
}

async function local(page: Page) {
  return page.evaluate(async () => {
    const req = indexedDB.open('protocol'); await new Promise<void>(r => { req.onsuccess = () => r(); });
    const tx = req.result.transaction(['meta', 'carePlans', 'plan', 'entries']);
    const read = <T,>(store: string, key?: string) => new Promise<T>(resolve => {
      const request = key ? tx.objectStore(store).get(key) : tx.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result);
    });
    const result = { meta: await read<any>('meta', 'sync'), plans: await read<any[]>('carePlans'), journal: await read<any>('plan', 'main'), entries: await read<any[]>('entries') };
    req.result.close(); return result;
  });
}

function track(page: Page) {
  const posts: { url: string; body: any }[] = [];
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/records')) posts.push({ url: r.url(), body: r.postDataJSON() }); });
  return posts;
}

test('startup resumes a saved source send after a lost acknowledgement without a legacy sync claim', async ({ browser, request }) => {
  const f = await fixture(request, 'accepted'), page = await device(browser, 'skip'), posts = track(page);
  await seed(page, f.rows); await page.goto('./#/sync');
  await expect(page.getByText(t.sync.source.acknowledged, { exact: true })).toBeVisible();
  await expect(page.getByText(t.sync.errors.source_plan_migration_required, { exact: true })).toBeVisible();
  const data = await local(page);
  expect(data.meta.sourcePlanDelivery.pending).toBeUndefined(); expect(data.meta.sourcePlanDelivery.acknowledged.record).toEqual(f.pending.record);
  expect(data.meta.seq).toBe(77); expect(data.plans[0].title).toBe('Нові локальні зміни плану');
  expect(data.journal.questions).toEqual(['Синтетичний локальний журнал']); expect(data.entries).toEqual([]);
  expect(posts.length).toBeGreaterThan(0); expect(posts.every(p => p.url.endsWith('/records/conditional') && p.body.expectedSeq === 0)).toBe(true);
  await expect(page.getByText(/Востаннє:/)).toHaveCount(0);
  const remote = await (await request.get(`${f.root}/records?since=0&protocol=2`, { headers: f.headers })).json();
  expect(remote.records).toHaveLength(1); expect(remote.records[0].v).toBe(f.pending.record.v);
  await page.context().close();
});

test('the real conflict screen preserves versions across refresh, stop and resume in both themes', async ({ browser, request }) => {
  const f = await fixture(request, 'conflict'), page = await device(browser, 'skip'), posts = track(page);
  await seed(page, f.rows); await page.goto('./#/sync');
  const section = page.getByRole('region', { name: t.sync.source.title, exact: true });
  await expect(section.getByText(t.sync.source.conflict, { exact: true })).toBeVisible();
  for (const label of [t.sync.source.agreed, t.sync.source.prepared, t.sync.source.local, t.sync.source.remote]) await section.locator('summary').filter({ hasText: label }).click();
  await expect(section.getByText(t.sync.source.noBaseline, { exact: true })).toBeVisible();
  for (const title of ['Підготовлена версія плану', 'Нові локальні зміни плану', 'Версія плану з іншого пристрою']) await expect(section.getByText(title, { exact: true })).toBeVisible();
  for (const width of [320, 1024]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const summary of await section.locator('summary').all()) expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `test-results/sync-source-conflict-${width}-${colorScheme}.png`, fullPage: true, animations: 'disabled' });
  }
  const before = await local(page); expect(before.meta.sourcePlanDelivery.pending).toEqual(f.pending);
  await page.getByRole('button', { name: t.sync.now, exact: true }).click();
  await expect(section.getByText(t.sync.source.conflict, { exact: true })).toBeVisible();
  expect((await local(page)).meta.sourcePlanDelivery.pending).toEqual(f.pending);
  await page.getByRole('button', { name: t.sync.off, exact: true }).click();
  await page.getByRole('button', { name: t.sync.offYes, exact: true }).click();
  await expect(page.getByRole('button', { name: t.sync.resume, exact: true })).toBeVisible();
  expect((await local(page)).meta.sourcePlanDelivery.pending).toEqual(f.pending);
  const stopped = posts.length; await page.reload();
  await expect(page.getByText(t.sync.source.paused, { exact: true })).toBeVisible();
  expect(posts).toHaveLength(stopped);
  await page.getByRole('button', { name: t.sync.resume, exact: true }).click();
  await expect(section.getByText(t.sync.source.conflict, { exact: true })).toBeVisible();
  expect((await local(page)).plans).toEqual(before.plans); expect((await local(page)).meta.seq).toBe(77);
  expect(posts.every(p => p.url.endsWith('/records/conditional') && p.body.expectedSeq === 0)).toBe(true);
  await page.context().close();
});

test('offline recovery retains the exact pending packet and retries it after the network returns', async ({ browser, request }) => {
  const f = await fixture(request, 'empty'), page = await device(browser, 'skip', { sw: false });
  await page.route('**/records/conditional', route => route.abort());
  await seed(page, f.rows); await page.goto('./#/sync');
  await expect(page.getByText(t.sync.status.offline, { exact: true })).toBeVisible();
  await expect(page.getByText(t.sync.source.pending, { exact: true })).toBeVisible();
  expect((await local(page)).meta.sourcePlanDelivery.pending).toEqual(f.pending);
  await page.unroute('**/records/conditional');
  await page.getByRole('button', { name: t.sync.now, exact: true }).click();
  await expect(page.getByText(t.sync.source.acknowledged, { exact: true })).toBeVisible();
  expect((await local(page)).plans[0].title).toBe('Нові локальні зміни плану');
  const remote = await (await request.get(`${f.root}/records?since=0&protocol=2`, { headers: f.headers })).json();
  expect(remote.records).toHaveLength(1); expect(remote.records[0].v).toBe(f.pending.record.v);
  await page.context().close();
});

test('unsupported discovery preserves the queue without any source or legacy write', async ({ browser, request }) => {
  const f = await fixture(request, 'empty'), page = await device(browser, 'skip', { sw: false }), posts = track(page);
  await page.route('**/records/conditional/capabilities', route => route.fulfill({ json: { minimum: 1, supported: 2 } }));
  await seed(page, f.rows); await page.goto('./#/sync');
  await expect(page.getByText(t.sync.errors.conditional_records_unsupported, { exact: true })).toBeVisible();
  expect(posts).toEqual([]); expect((await local(page)).meta.sourcePlanDelivery.pending).toEqual(f.pending);
  expect((await local(page)).meta.seq).toBe(77);
  await page.unroute('**/records/conditional/capabilities');
  await page.getByRole('button', { name: t.sync.now, exact: true }).click();
  await expect(page.getByText(t.sync.source.acknowledged, { exact: true })).toBeVisible();
  expect(posts.every(p => p.url.endsWith('/records/conditional') && p.body.expectedSeq === 0)).toBe(true);
  await page.context().close();
});

test('restoring a file blocks automatic replay of a pre-restore send and keeps both local versions', async ({ browser, request }) => {
  const f = await fixture(request, 'empty'), page = await device(browser, 'skip', { sw: false }), posts = track(page);
  await page.route('**/records/conditional', route => route.abort());
  await seed(page, f.rows); await page.goto('./#/sync');
  await expect(page.getByText(t.sync.status.offline, { exact: true })).toBeVisible();
  f.file.sourcePlans!.plans[0]!.title = 'Відновлена з копії версія плану';
  await page.goto('./#/data');
  await expect(page).toHaveURL(/#\/data$/);
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic-source-recovery.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(f.file)) });
  await page.getByRole('alertdialog', { name: t.backup.restore }).getByRole('button', { name: t.backup.yes, exact: true }).click();
  await expect(page.getByText(t.backup.restored, { exact: true })).toBeVisible();
  const stopped = posts.length; await page.unroute('**/records/conditional');
  await page.goto('./#/sync'); await page.getByRole('button', { name: t.sync.now, exact: true }).click();
  await expect(page.getByText(t.sync.errors.source_plan_restore_required, { exact: true })).toBeVisible();
  await expect(page.getByText(t.sync.source.restored, { exact: true })).toBeVisible();
  expect(posts).toHaveLength(stopped);
  const data = await local(page);
  expect(data.meta.sourcePlanDelivery.pending).toEqual(f.pending); expect(data.meta.sourcePlanDelivery.blocked).toBe('restore');
  expect(data.plans[0].title).toBe('Відновлена з копії версія плану'); expect(data.meta.seq).toBe(77);
  await page.reload(); await expect(page.getByText(t.sync.source.restored, { exact: true })).toBeVisible();
  expect(posts).toHaveLength(stopped);
  await page.context().close();
});
