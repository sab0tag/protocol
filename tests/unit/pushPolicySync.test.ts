import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/domain/rollout', () => ({ MODULE_POLICY_ENABLED: true }));
vi.mock('../../src/sync/api', async (original) => ({ ...await original<typeof import('../../src/sync/api')>(),
  putReminderPolicy: vi.fn(), putReminders: vi.fn() }));
import { db } from '../../src/data/db';
import { ApiError, putReminderPolicy, putReminders } from '../../src/sync/api';
import { pushSchedule, reconcileReminderPolicy } from '../../src/sync/push';
import type { Keys } from '../../src/sync/crypto';

let keys: Keys;
beforeEach(async () => {
  vi.mocked(putReminderPolicy).mockReset(); vi.mocked(putReminders).mockReset();
  keys = { vaultId: crypto.randomUUID(), auth: '', enc: {} as CryptoKey, mac: {} as CryptoKey };
  await db.meta.put({ key: 'sync', code: 'local-test', seq: 0 });
  await db.moduleEvents.put({ id: 'off', v: 1, kind: 'module', module: 'water', enabled: false, source: 'manual', at: '2026-10-01T00:00:00.000Z' });
});
afterEach(async () => { await db.moduleEvents.clear(); await db.meta.clear(); });

describe('policy acknowledgement and offline retry (D136)', () => {
  it('persists pending while offline, retries without a push subscription and acknowledges only on success', async () => {
    vi.mocked(putReminderPolicy).mockRejectedValueOnce(new ApiError(0, 'offline'));
    await expect(pushSchedule(keys)).rejects.toMatchObject({ code: 'offline' });
    expect(await db.meta.get('sync')).toMatchObject({ reminderPolicyState: 'pending' });
    expect((await db.meta.get('sync'))?.reminderPolicyAck).toBeUndefined();
    vi.mocked(putReminderPolicy).mockResolvedValue({ ok: true, v: 1 });
    await pushSchedule(keys);
    expect(await db.meta.get('sync')).toMatchObject({ reminderPolicyState: 'synced' });
    expect(putReminderPolicy).toHaveBeenCalledTimes(2);
    expect(putReminders).not.toHaveBeenCalled();
  });

  it('does not mark a newer local change as acknowledged by an older in-flight request', async () => {
    vi.mocked(putReminderPolicy).mockImplementationOnce(async () => {
      await db.moduleEvents.put({ id: 'new-on', v: 1, kind: 'module', module: 'water', enabled: true, source: 'manual', at: '2026-10-02T00:00:00.000Z' });
      return { ok: true, v: 1 };
    });
    await reconcileReminderPolicy(keys);
    expect((await db.meta.get('sync'))?.reminderPolicyState).toBe('pending');
    vi.mocked(putReminderPolicy).mockResolvedValue({ ok: true, v: 1 });
    await reconcileReminderPolicy(keys);
    expect(vi.mocked(putReminderPolicy).mock.calls[1]?.[1].modules.water?.enabled).toBe(true);
    expect((await db.meta.get('sync'))?.reminderPolicyState).toBe('synced');
  });

  it('requires protocol acknowledgement and can force reconciliation after a server restore', async () => {
    vi.mocked(putReminderPolicy).mockResolvedValueOnce({ ok: true, v: 2 } as never);
    await expect(reconcileReminderPolicy(keys)).rejects.toMatchObject({ code: 'reminder_policy_unsupported' });
    expect((await db.meta.get('sync'))?.reminderPolicyState).toBe('pending');
    vi.mocked(putReminderPolicy).mockResolvedValue({ ok: true, v: 1 });
    await reconcileReminderPolicy(keys);
    await reconcileReminderPolicy(keys);
    expect(putReminderPolicy).toHaveBeenCalledTimes(2);
    await reconcileReminderPolicy(keys, true);
    expect(putReminderPolicy).toHaveBeenCalledTimes(3);
  });
});
