// Real API transport + two independent local IndexedDB databases; runner/UI remain disabled.
import 'fake-indexeddb/auto';
import { expect, test } from '@playwright/test';
import { ProtocolDB } from '../../src/data/db';
import { profileDatabase } from '../../src/data/profiles';
import { emptyPlan } from '../../src/data/seed.example';
import { prepareLegacyPlanCore, saveClinicImport } from '../../src/data/carePlans';
import { confirmImport, previewClinicPlan } from '../../src/domain/planImport';
import { deriveKeys, newCode, parseCode } from '../../src/sync/crypto';
import { applySourcePlanCatalog, captureSourcePlanCatalog, encryptSourcePlanCatalog } from '../../src/sync/sourcePlans';

test('protocol-2 opaque catalog crosses the real vault API; protocol-1 requests are refused', async ({ request }) => {
  const code = newCode(), keys = await deriveKeys(parseCode(code)!);
  const people = [crypto.randomUUID(), crypto.randomUUID()];
  const databases = people.map(p => new ProtocolDB(profileDatabase(p)));
  const [a, b] = databases as [ProtocolDB, ProtocolDB];
  const root = `http://localhost:8099/v1/vaults/${keys.vaultId}`, headers = { Authorization: `Bearer ${keys.auth}` };
  try {
    for (const db of databases) {
      await db.meta.put({ key: 'sync', code, seq: 0 });
      await db.plan.put({ ...emptyPlan(), id: 'main' });
    }
    const preview = previewClinicPlan({ schemaVersion: 1, planId: 'synthetic-transport-plan', organizationId: 'clinic', issuedAt: '2026-10-30T10:00:00Z',
      clinician: { displayName: 'Synthetic doctor', organizationName: 'Synthetic clinic' }, title: 'Synthetic transport plan',
      medications: [{ name: 'Synthetic instruction', dose: '1 unit', frequency: 'Once daily', duration: '7 days', instructions: 'Check source' }], restrictions: [], tests: [] })!;
    await saveClinicImport(a, people[0]!, confirmImport(preview, ['med:0'], people[0]!)!);
    expect((await request.put(root, { headers })).ok()).toBe(true);
    expect((await request.put(`${root}/write-protocol`, { headers, data: { minimum: 2, protocol: 2 } })).ok()).toBe(true);
    const record = await encryptSourcePlanCatalog(keys, await captureSourcePlanCatalog(a));
    expect((await request.post(`${root}/records/conditional`, { headers, data: { protocol: 2, expectedSeq: 0, records: [record] } })).ok()).toBe(true);
    const response = await request.get(`${root}/records?since=0&protocol=2`, { headers }); expect(response.ok()).toBe(true);
    const page = await response.json(); expect(page.records).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain('Synthetic'); expect(JSON.stringify(page)).not.toContain(people[0]!);
    const before = await b.plan.get('main');
    await applySourcePlanCatalog(b, keys, page.records[0], await captureSourcePlanCatalog(b));
    expect(await captureSourcePlanCatalog(b)).toEqual(await captureSourcePlanCatalog(a));
    expect((await b.carePlans.toArray())[0]).toMatchObject({ personId: people[1], status: 'draft' });
    expect((await b.carePlanItems.toArray())[0]).toMatchObject({ personId: people[1], provenance: { verification: 'pending' } });
    expect(await b.plan.get('main')).toEqual(before); expect(await b.entries.count()).toBe(0);
    // Two offline edits based on the same remote revision cannot silently replace each other.
    const original = await captureSourcePlanCatalog(a), first = structuredClone(original), second = structuredClone(original);
    first.plans[0]!.title = 'Synthetic edit from first device'; second.plans[0]!.title = 'Synthetic edit from second device';
    const candidates = await Promise.all([encryptSourcePlanCatalog(keys, first), encryptSourcePlanCatalog(keys, second)]);
    const attempts = await Promise.all(candidates.map(candidate => request.post(`${root}/records/conditional`, {
      headers, data: { protocol: 2, expectedSeq: page.seq, records: [candidate] },
    })));
    expect(attempts.map(r => r.status()).sort()).toEqual([200, 409]);
    const winner = attempts.findIndex(r => r.status() === 200);
    const finalPage = await (await request.get(`${root}/records?since=0&protocol=2`, { headers })).json();
    expect(finalPage.records[0].v).toBe(candidates[winner]!.v);
    const conflict = await attempts.find(r => r.status() === 409)!.json();
    expect(conflict).toEqual({ error: 'record_conflict', seq: finalPage.seq });
    await applySourcePlanCatalog(b, keys, finalPage.records[0], await captureSourcePlanCatalog(b));
    expect(await captureSourcePlanCatalog(b)).toEqual(winner === 0 ? first : second);
    expect(await captureSourcePlanCatalog(a)).toEqual(original);
    // A lost-response replay is a conflict, never a second write or a blind overwrite.
    expect((await request.post(`${root}/records/conditional`, { headers, data: { protocol: 2, expectedSeq: page.seq, records: [candidates[winner]] } })).status()).toBe(409);
    for (const response of [await request.get(`${root}/records?since=0&protocol=1`, { headers }),
      await request.post(`${root}/records`, { headers, data: { protocol: 1, records: [record] } })]) {
      expect(response.status()).toBe(409); expect((await response.json()).error).toBe('client_upgrade_required');
    }
    expect(await (await request.get(`${root}/records?since=0&protocol=2`, { headers })).json()).toEqual(finalPage);
  } finally { for (const db of databases) await db.delete(); }
});

// The delivery adapter runs against actual HTTP and independent IndexedDB emulations.
// This exercises persistence/recovery, not a browser conflict UI or a rollout.
test('durable source send survives lost HTTP response, reopen and a competing device', async ({ request }) => {
  const { ApiError } = await import('../../src/sync/api');
  const { prepareSourcePlanSend, deliverSourcePlanSend } = await import('../../src/sync/sourcePlanDelivery');
  const code = newCode(), keys = await deriveKeys(parseCode(code)!);
  const headers = { Authorization: `Bearer ${keys.auth}` }, root = `http://localhost:8099/v1/vaults/${keys.vaultId}`;
  let a = new ProtocolDB(profileDatabase(crypto.randomUUID()));
  const b = new ProtocolDB(profileDatabase(crypto.randomUUID()));
  const api = {
    push: async (records: { k: string; v: string | null }[], expectedSeq: number) => {
      const response = await request.post(`${root}/records/conditional`, { headers, data: { records, expectedSeq, protocol: 2 } });
      const data = await response.json(); if (!response.ok()) throw new ApiError(response.status(), data.error, data);
      return data as { seq: number };
    },
    pull: async (since: number) => {
      // Force pagination through unrelated records too; acknowledgement must read to the end.
      const response = await request.get(`${root}/records?since=${since}&limit=1&protocol=2`, { headers });
      const data = await response.json(); if (!response.ok()) throw new ApiError(response.status(), data.error, data);
      return data;
    },
  };
  try {
    for (const db of [a, b]) await db.meta.put({ key: 'sync', code, seq: 0 });
    await a.plan.put({ ...emptyPlan(), id: 'main' });
    await prepareLegacyPlanCore(a, a.name.slice('protocol-profile-'.length));
    expect((await request.put(root, { headers })).ok()).toBe(true);
    expect((await request.put(`${root}/write-protocol`, { headers, data: { minimum: 2, protocol: 2 } })).ok()).toBe(true);
    const first = await prepareSourcePlanSend(a, keys, 0);
    await expect(deliverSourcePlanSend(a, keys, { ...api, push: async (...args) => {
      await api.push(...args); throw new ApiError(0, 'offline'); // HTTP committed; caller never sees its acknowledgement.
    } })).rejects.toMatchObject({ code: 'offline' });
    a.close(); a = new ProtocolDB(a.name);
    expect((await a.meta.get('sync'))!.sourcePlanDelivery!.pending).toEqual(first);
    const firstRemote = await api.pull(0), firstSeq = firstRemote.records[0].seq;
    // The full vault revision can advance independently of this source catalog.
    const unrelatedKey = (await import('../../src/sync/crypto')).recordKey;
    const unrelated = { k: await unrelatedKey(keys, 'synthetic:unrelated'), v: 'AAAA' };
    const unrelatedAck = await api.push([unrelated], firstSeq);
    expect(await deliverSourcePlanSend(a, keys, api)).toEqual({ status: 'acknowledged', seq: firstSeq, recovered: true });
    expect((await a.meta.get('sync'))!.seq).toBe(0);
    await applySourcePlanCatalog(b, keys, first.record, await captureSourcePlanCatalog(b));
    const plan = (await a.carePlans.toArray())[0]!;
    await a.carePlans.update(plan.id, { title: 'Synthetic first device edit' });
    await b.carePlans.update(plan.id, { title: 'Synthetic second device edit' });
    const localA = await captureSourcePlanCatalog(a), localB = await captureSourcePlanCatalog(b);
    // Two devices independently prepare at the same complete revision: retain the losing pending draft.
    const pendingA = await prepareSourcePlanSend(a, keys, unrelatedAck.seq);
    const pendingB = await prepareSourcePlanSend(b, keys, unrelatedAck.seq);
    const results = await Promise.all([deliverSourcePlanSend(a, keys, api), deliverSourcePlanSend(b, keys, api)]);
    expect(results.map(r => r.status).sort()).toEqual(['acknowledged', 'conflict']);
    const loser = results[0].status === 'conflict' ? a : b, saved = loser === a ? pendingA : pendingB;
    expect((await loser.meta.get('sync'))!.sourcePlanDelivery!.pending).toEqual(saved);
    const final = await (await request.get(`${root}/records?since=0&protocol=2`, { headers })).json();
    const winningRecord = loser === a ? pendingB.record : pendingA.record;
    expect(final.records.find((r: { k: string }) => r.k === first.record.k).v).toBe(winningRecord.v);
    expect(await captureSourcePlanCatalog(a)).toEqual(localA);
    expect(await captureSourcePlanCatalog(b)).toEqual(localB);
  } finally { await a.delete(); await b.delete(); }
});
