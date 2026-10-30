import { afterEach, describe, expect, it, vi } from 'vitest';
import { conditionalVaultApi } from '../../src/sync/api';
import type { Keys } from '../../src/sync/crypto';
afterEach(() => vi.unstubAllGlobals());
describe('conditional transport never falls back to a blind write', () => {
  for (const status of [404, 409, 503]) it(`preserves the failed condition on HTTP ${status} without guessing a new revision or retrying a legacy route`, async () => {
    const fetcher = vi.fn(async () => Response.json({ error: status === 409 ? 'record_conflict' : 'unavailable', seq: 99 }, { status }));
    vi.stubGlobal('fetch', fetcher);
    const keys = { vaultId: 'a'.repeat(32), auth: 'synthetic-test-auth' } as Keys;
    await expect(conditionalVaultApi(keys).push([{ k: 'synthetic-key', v: 'AAAA' }], 0)).rejects.toMatchObject({ status });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain('/records/conditional');
    expect(JSON.parse(options.body as string)).toMatchObject({ protocol: 2, expectedSeq: 0 });
  });
});
