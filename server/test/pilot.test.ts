import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { pilotHousekeeping, weekAdd, weekKey, weekMonday } from '../src/pilot.ts';
import { opsStats, pilotStats, table } from '../src/stats.ts';
import { tick } from '../src/push.ts';
import { Store } from '../src/store.ts';

const NOW = new Date('2026-11-04T10:00:00Z'); // Wednesday of 2026-W45
const IP = '203.0.113.77';

function setup(now = NOW) {
  const store = Store.migrated(':memory:');
  let at = now;
  const app = createApp({ store, origins: [], now: () => at });
  const call = (m: string, path: string, auth?: string, body?: unknown) => app.request(path, { method: m,
    headers: { 'X-Forwarded-For': IP, ...(auth ? { Authorization: auth } : {}), 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const join = async () => {
    const r = await call('POST', '/v1/pilot/join');
    expect(r.status).toBe(201);
    const j = await r.json() as { pid: string; secret: string };
    return { ...j, auth: `Pilot ${j.pid}.${j.secret}` };
  };
  return { store, app, call, join, setNow: (d: Date) => { at = d; } };
}

const summary = (pid: string, week: string, extra: Record<string, unknown> = {}) => ({
  v: 1, pid, week, src: 'ENDO-01', days_in: 23, active_days: 6,
  meds: { due: 14, done: 12, skipped: 1, late_30: 2, prn_taken: 3 },
  food: { days_logged: 6, entries: 14, by_voice: 9, by_text: 4, by_photo: 1, not_found: 2 },
  plan: { meds: 4, constraints: 3, from_photo: true, photo_rows: 9, photo_rows_edited: 1, photo_rows_unchecked: 2 },
  help: { why_opened: 3, topup_shown: 2, topup_taken: 1, danger_card: 0 },
  rem: { sent: 14, opened: 11 },
  other: { water_days: 5, workouts: 2, wellbeing_days: 4, report_made: 0 },
  app: { build: 'index-DvpmBBM0', platform: 'ios-pwa' },
  ...extra,
});
const rows = (store: Store, pid?: string) => pid
  ? store.all<{ n: number }>('SELECT COUNT(*) AS n FROM pilot_weeks WHERE pid = ?', pid)[0]!.n
  : store.all<{ n: number }>('SELECT COUNT(*) AS n FROM pilot_weeks')[0]!.n;

describe('pilot (D119)', () => {
  it('join gives a random pid and a secret; the server keeps the hash and the week only', async () => {
    const { store, join } = setup();
    const a = await join(), b = await join();
    expect(a.pid).toMatch(/^p_[a-z2-7]{10}$/);
    expect(a.pid).not.toBe(b.pid);
    const m = store.all<{ secret_hash: string; joined: string }>('SELECT secret_hash, joined FROM pilot_members WHERE pid = ?', a.pid)[0]!;
    expect(m.joined).toBe('2026-W45');
    expect(m.secret_hash).toBe(createHash('sha256').update(a.secret).digest('hex'));
  });

  it('a week is written once — a repeat replaces it', async () => {
    const { store, call, join } = setup();
    const p = await join();
    expect((await call('POST', '/v1/pilot/week', p.auth, summary(p.pid, '2026-W44'))).status).toBe(200);
    expect((await call('POST', '/v1/pilot/week', p.auth, summary(p.pid, '2026-W44', { active_days: 7 }))).status).toBe(200);
    expect(rows(store, p.pid)).toBe(1);
    const body = JSON.parse(store.all<{ body: string }>('SELECT body FROM pilot_weeks')[0]!.body);
    expect(body.active_days).toBe(7);
  });

  it('strict schema: an extra field, a string for a number, a name, a missing count → 400 and nothing written', async () => {
    const { store, call, join } = setup();
    const p = await join();
    const bad = [
      summary(p.pid, '2026-W44', { vault: 'a'.repeat(32) }),
      summary(p.pid, '2026-W44', { days_in: '23' }),
      summary(p.pid, '2026-W44', { meds: { due: 14, done: 12, skipped: 1, late_30: 2, prn_taken: 3, name: 'Метформін' } }),
      summary(p.pid, '2026-W44', { meds: { due: 14, done: 12.5, skipped: 1, late_30: 2, prn_taken: 3 } }),
      summary(p.pid, '2026-W44', { app: { build: 'index-DvpmBBM0', platform: 'ios-pwa', ua: 'Mozilla' } }),
      summary(p.pid, '2026-W44', { src: 'ендо 01' }),
      (({ food: _, ...rest }) => rest)(summary(p.pid, '2026-W44')),
      { v: 1, pid: p.pid, week: '2026-W44', survey: 'd7', q: { helps: 4, nps: 9 } },
      { v: 1, pid: p.pid, week: '2026-W44', survey: 'd7', q: { helps: 6 } },
    ];
    for (const b of bad) expect((await call('POST', '/v1/pilot/week', p.auth, b)).status).toBe(400);
    expect(rows(store)).toBe(0);
  });

  it('only its own pid, only the last 4 weeks, only with the secret', async () => {
    const { store, call, join } = setup();
    const p = await join(), q = await join();
    expect((await call('POST', '/v1/pilot/week', p.auth, summary(q.pid, '2026-W44'))).status).toBe(400);
    expect((await call('POST', '/v1/pilot/week', p.auth, summary(p.pid, '2026-W39'))).status).toBe(400);
    expect((await call('POST', '/v1/pilot/week', p.auth, summary(p.pid, '2026-W46'))).status).toBe(400);
    expect((await call('POST', '/v1/pilot/week', `Pilot ${p.pid}.${q.secret}`, summary(p.pid, '2026-W44'))).status).toBe(401);
    expect((await call('POST', '/v1/pilot/week', undefined, summary(p.pid, '2026-W44'))).status).toBe(401);
    expect((await call('POST', '/v1/pilot/week', p.auth, summary(p.pid, '2026-W41'))).status).toBe(200);
    expect(rows(store)).toBe(1);
  });

  it('surveys and a note; the note has names replaced', async () => {
    const { store, call, join } = setup();
    const p = await join();
    expect((await call('POST', '/v1/pilot/week', p.auth, { v: 1, pid: p.pid, week: '2026-W45', survey: 'd7', q: { helps: 4, blocker: 'forget' } })).status).toBe(200);
    expect((await call('POST', '/v1/pilot/week', p.auth, { v: 1, pid: p.pid, week: '2026-W45', survey: 'd30', q: { helps: 5, report: 'no_visit', nps: 9 } })).status).toBe(200);
    expect((await call('POST', '/v1/pilot/week', p.auth, { v: 1, pid: p.pid, week: '2026-W45', nid: 'abc123', note: 'Довго шукав сирники. Дружина Оксана каже — додайте.' })).status).toBe(200);
    const kinds = store.all<{ kind: string; body: string }>('SELECT kind, body FROM pilot_weeks ORDER BY kind');
    expect(kinds.map((k) => k.kind)).toEqual(['d30', 'd7', 'note:abc123']);
    expect(JSON.parse(kinds[2]!.body).note).toBe('Довго шукав сирники. Дружина [ім’я] каже — додайте.');
  });

  it('«Видалити надіслане»: no row of the pid is left, the old secret no longer works', async () => {
    const { store, call, join } = setup();
    const p = await join(), q = await join();
    await call('POST', '/v1/pilot/week', p.auth, summary(p.pid, '2026-W44'));
    await call('POST', '/v1/pilot/week', q.auth, summary(q.pid, '2026-W44'));
    expect((await call('DELETE', '/v1/pilot', p.auth)).status).toBe(200);
    expect(rows(store, p.pid)).toBe(0);
    expect(store.all('SELECT 1 FROM pilot_members WHERE pid = ?', p.pid)).toEqual([]);
    expect(rows(store, q.pid)).toBe(1);
    expect((await call('POST', '/v1/pilot/week', p.auth, summary(p.pid, '2026-W45'))).status).toBe(404);
  });

  it('a source code: known or not; the QR visit counts (day, code), a typed code does not; the address is not kept', async () => {
    const { store, app, call } = setup();
    store.putPilotSource('ENDO-01', 'Ендокринолог, клініка 1', '2026-10-24');
    expect(await (await call('GET', '/v1/pilot/src/ENDO-01?visit=1')).json()).toEqual({ known: true });
    expect(await (await call('GET', '/v1/pilot/src/endo-01')).json()).toEqual({ known: true });
    expect(await (await call('GET', '/v1/pilot/src/NOPE-99?visit=1')).json()).toEqual({ known: false });
    expect(store.all('SELECT day, n FROM counters WHERE scope = ?', 'qr:ENDO-01')).toEqual([{ day: '2026-11-04', n: 1 }]);
    expect(store.all('SELECT 1 FROM counters WHERE scope LIKE ?', 'qr:NOPE%')).toEqual([]);
    await call('POST', '/v1/pilot/join');
    await call('POST', '/v1/devices');
    await call('GET', '/v1/pair/abcdefabcdefabcdefabcdefabcdefab');
    await app.request(`/v1/vaults/${'c'.repeat(32)}`, { method: 'PUT', headers: { Authorization: `Bearer ${'k'.repeat(43)}`, 'X-Forwarded-For': IP } });
    const scopes = store.all<{ scope: string }>('SELECT scope FROM counters').map((r) => r.scope);
    expect(scopes.filter((s) => /^(vault|devtoken|pairget|pilotjoin):/.test(s))).toHaveLength(4); // D122: every limit by address — a hash
    expect(scopes.some((r) => r.includes(IP) || r.includes('203.0.113'))).toBe(false);
  });

  it('10 joins a day from one address', async () => {
    const { call } = setup();
    for (let i = 0; i < 10; i += 1) expect((await call('POST', '/v1/pilot/join')).status).toBe(201);
    expect((await call('POST', '/v1/pilot/join')).status).toBe(429);
  });

  it('nightly: records after 12 months go, and a member with nothing left', () => {
    const store = Store.migrated(':memory:');
    store.joinPilot('p_aaaaaaaaaa', 'h', '2025-W40');
    store.putPilotWeek('p_aaaaaaaaaa', '2025-W41', 'week', null, '{}');
    store.joinPilot('p_bbbbbbbbbb', 'h', '2026-W40');
    store.putPilotWeek('p_bbbbbbbbbb', '2026-W41', 'week', null, '{}');
    store.seen('a'.repeat(32), '2025-W01');
    store.take('vault:abc', 5, new Date('2026-11-01T10:00:00Z'));
    store.take('vault:def', 5, new Date('2026-11-03T10:00:00Z'));
    store.bump('stat:rem_sent', 1, new Date('2026-01-01T10:00:00Z'));
    store.bump('qr:ENDO-01', 1, new Date('2026-01-01T10:00:00Z'));
    expect(pilotHousekeeping(store, NOW)).toEqual({ pilot: 1, seen: 1, counters: 1 });
    expect(store.all<{ scope: string }>('SELECT scope FROM counters ORDER BY scope').map((r) => r.scope)).toEqual(['qr:ENDO-01', 'stat:rem_sent', 'vault:def']);
    expect(store.all<{ pid: string }>('SELECT pid FROM pilot_members').map((r) => r.pid)).toEqual(['p_bbbbbbbbbb']);
  });
});

describe('week keys', () => {
  it('ISO weeks across a year end', () => {
    expect(weekKey(new Date('2026-12-31T12:00:00Z'))).toBe('2026-W53');
    expect(weekKey(new Date('2027-01-04T00:00:00Z'))).toBe('2027-W01');
    expect(weekAdd('2026-W53', 1)).toBe('2027-W01');
    expect(new Date(weekMonday('2026-W45')).toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });
});

describe('stats:pilot', () => {
  it('20 made-up participants: the summary table; a code of 4 is not shown on its own', () => {
    const store = Store.migrated(':memory:');
    store.putPilotSource('ENDO-01', 'Ендокринолог, клініка 1', '2026-10-01');
    store.putPilotSource('CARD-02', 'Кардіолог, клініка 2', '2026-10-01');
    for (let d = 0; d < 30; d += 1) store.bump('qr:ENDO-01', 1, new Date(Date.UTC(2026, 9, 26 + (d % 5))));
    for (let i = 0; i < 20; i += 1) {
      const pid = `p_${String.fromCharCode(97 + i).repeat(10)}`, src = i < 16 ? 'ENDO-01' : 'CARD-02';
      const joined = i < 10 ? '2026-W44' : '2026-W45';
      store.joinPilot(pid, 'h', joined);
      for (let k = 0; k < 6; k += 1) {
        const week = weekAdd(joined, k);
        if (week > '2026-W50' || (i % 4 === 3 && k >= 1)) continue; // every 4th drops out after the first week
        store.putPilotWeek(pid, week, 'week', src, JSON.stringify(summary(pid, week, { src, active_days: 3 + (i % 5),
          meds: { due: 14, done: 10 + (i % 5), skipped: 0, late_30: 1, prn_taken: 0 }, food: { days_logged: 4 + (i % 4), entries: 10, by_voice: 6, by_text: 4, by_photo: 0, not_found: 1 } })));
      }
      store.putPilotWeek(pid, weekAdd(joined, 1), 'd7', null, JSON.stringify({ q: { helps: 3 + (i % 3), blocker: i % 2 ? 'forget' : 'slow_food' } }));
    }
    const { rows, hidden } = pilotStats(store, '2026-W44', '2026-W50');
    expect(hidden).toBe(1);
    expect(new Set(rows.map((r) => r.group))).toEqual(new Set(['всього', 'ENDO-01 · Ендокринолог, клініка 1']));
    const total = rows.find((r) => r.group === 'всього' && r.week === 'всього')!;
    expect(total).toMatchObject({ consents: 20, plan_entered: 20, qr: 30, ret_w2: 75, marked: 86, on_time: 92, nf_per_entry: 10, voice: 60, photo_edited: 11, photo_unchecked: 22 });
    expect(total.helps_d7).toBe(4);
    expect(total.blockers).toBe('forget 10, slow_food 10');
    expect(rows.find((r) => r.group === 'всього' && r.week === '2026-W45')).toMatchObject({ consents: 10, ret_w2: 80 }) // the W44 ones in their 2nd week: 3 and 7 dropped out;
    const md = table(rows, 'md'), csv = table(rows, 'csv');
    expect(md).not.toMatch(/p_[a-z]{10}|CARD-02/);
    expect(csv.split('\n')[0]).toMatch(/^group,week,participants,qr,consents/);
  });
});

describe('stats:ops', () => {
  it('new vaults, the weeks online, returns, reminders that came and the reactions to them', async () => {
    const store = Store.migrated(':memory:');
    const hash = (s: string) => createHash('sha256').update(s).digest('hex');
    const ids = ['a', 'b', 'c'].map((x) => x.repeat(32));
    for (const id of ids) store.createVault(id, hash('k'), new Date('2026-10-27T09:00:00Z')); // W44
    for (const id of ids) store.seen(id, '2026-W44');
    store.seen(ids[0]!, '2026-W45');
    // a reminder pushed, its repeat pushed, then ticked 30 min after its time
    const t0 = Date.parse('2026-11-03T08:00:00Z');
    store.putSub(ids[0]!, 'd'.repeat(32), '{}', t0);
    store.setReminders(ids[0]!, 'd'.repeat(32), [{ rid: 'r'.repeat(20), at: t0, payload: '{}' }], 15, 2, [], t0 - 1000);
    await tick(store, async () => 'ok', t0);
    await tick(store, async () => 'ok', t0 + 15 * 60_000);
    store.setReminders(ids[0]!, 'd'.repeat(32), [], 15, 2, ['r'.repeat(20)], t0 + 30 * 60_000);
    const { weeks } = opsStats(store, NOW, 2);
    expect(weeks.map((w) => w.week)).toEqual(['2026-W44', '2026-W45']);
    expect(weeks[0]).toMatchObject({ new_vaults: 3, active: 3, back_w1: 33, back_w4: null });
    expect(weeks[1]).toMatchObject({ active: 1, active_30: 3, rem_sent: 1, rem_acked: 1, rem_acked_pct: 100, rem_ack_min: 30 });
    expect(JSON.stringify(weeks)).not.toContain('a'.repeat(32));
  });
});

describe('the counts hang together (R17)', () => {
  it('a summary that contradicts itself is refused whole; a phone ahead of UTC is not refused', async () => {
    const { store, call, join, setNow } = setup();
    const p = await join();
    const bad = [
      summary(p.pid, '2026-W44', { meds: { due: 10, done: 9, skipped: 2, late_30: 0, prn_taken: 0 } }), // done + skipped > due
      summary(p.pid, '2026-W44', { meds: { due: 10, done: 3, skipped: 0, late_30: 4, prn_taken: 0 } }), // late > done
      summary(p.pid, '2026-W44', { food: { days_logged: 6, entries: 14, by_voice: 9, by_text: 4, by_photo: 0, not_found: 2 } }), // 13 ≠ 14
      summary(p.pid, '2026-W44', { active_days: 3 }), // food on 6 days of 3 active
      summary(p.pid, '2026-W44', { plan: { meds: 1, constraints: 1, from_photo: true, photo_rows: 2, photo_rows_edited: 0, photo_rows_unchecked: 3 } }),
      summary(p.pid, '2027-W53'), // no such week
    ];
    for (const b of bad) expect((await call('POST', '/v1/pilot/week', p.auth, b)).status).toBe(400);
    expect(rows(store)).toBe(0);
    // Monday 01:30 in Kyiv is still Sunday in UTC — the phone's finished week W45 is the server's current one; W46's Monday
    // in Auckland (UTC+13) is Sunday 11:00 UTC — a phone there sends W45 only on its Monday, never refused
    setNow(new Date('2026-11-08T23:30:00Z'));
    expect((await call('POST', '/v1/pilot/week', p.auth, summary(p.pid, '2026-W45'))).status).toBe(200);
  });
});
