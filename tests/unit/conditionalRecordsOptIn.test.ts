import { afterEach, describe, expect, it, vi } from 'vitest';
import { optInConditionalRecords } from '../../src/sync/api';
import type { Keys } from '../../src/sync/crypto';
const keys = { vaultId: 'a'.repeat(32), auth: 'synthetic-test-auth' } as Keys;
const capability = { v: 1, protocol: 2, condition: 'vault-seq', minimum: 1 };
const ack = { minimum: 2, protocol: 2, condition: 'vault-seq' };
afterEach(() => vi.unstubAllGlobals());
describe('explicit conditional-record opt-in stays fail closed', () => {
  it('requires exact conditional discovery and uses a separate guarded opt-in endpoint', async () => {
    for (const minimum of [1, 2]) {
      const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ...capability, minimum })).mockResolvedValueOnce(Response.json(ack));
      vi.stubGlobal('fetch', fetcher); await optInConditionalRecords(keys);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[0]![0]).toContain('/records/conditional/capabilities');
      expect(fetcher.mock.calls[0]![1].method).toBe('GET');
      expect(fetcher.mock.calls[1]![0]).toContain('/write-protocol/conditional-records');
      expect(fetcher.mock.calls[1]![1].method).toBe('PUT');
      expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual(ack);
    }
  });
  it('rejects old generic supported:2 claims and malformed capabilities without any PUT', async () => {
    for (const body of [null, {}, { minimum: 1, supported: 2 }, { ...capability, v: 2 }, { ...capability, protocol: 1 },
      { ...capability, condition: 'blind' }, { ...capability, minimum: 0 }, { ...capability, minimum: '1' }]) {
      const fetcher = vi.fn(async () => Response.json(body)); vi.stubGlobal('fetch', fetcher);
      await expect(optInConditionalRecords(keys)).rejects.toMatchObject({ code: 'conditional_records_unsupported' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('never upgrades after discovery errors and never falls back after a server downgrade between GET and PUT', async () => {
    for (const status of [401, 404, 503]) {
      const fail = () => Response.json({ error: 'unavailable' }, { status });
      let fetcher = vi.fn<typeof fetch>(async () => fail()); vi.stubGlobal('fetch', fetcher);
      await expect(optInConditionalRecords(keys)).rejects.toMatchObject({ status }); expect(fetcher).toHaveBeenCalledTimes(1);
      fetcher = vi.fn().mockResolvedValueOnce(Response.json(capability)).mockResolvedValueOnce(fail()); vi.stubGlobal('fetch', fetcher);
      await expect(optInConditionalRecords(keys)).rejects.toMatchObject({ status }); expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1]![0]).toContain('/write-protocol/conditional-records');
    }
  });
  it('does not retry or downgrade when the acknowledgement is lost or malformed', async () => {
    for (const body of [null, {}, { minimum: 2, supported: 2 }, { ...ack, minimum: 1 }, { ...ack, condition: 'blind' }]) {
      const fetcher = vi.fn().mockResolvedValueOnce(Response.json(capability)).mockResolvedValueOnce(Response.json(body)); vi.stubGlobal('fetch', fetcher);
      await expect(optInConditionalRecords(keys)).rejects.toMatchObject({ code: 'conditional_records_ack_invalid' }); expect(fetcher).toHaveBeenCalledTimes(2);
    }
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(capability)).mockRejectedValueOnce(new Error('synthetic lost response')); vi.stubGlobal('fetch', fetcher);
    await expect(optInConditionalRecords(keys)).rejects.toMatchObject({ code: 'offline' }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
