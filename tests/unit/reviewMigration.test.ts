import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { ProtocolDB } from '../../src/data/db';
import { REVIEW_ID, type ReviewDraft } from '../../src/data/reviewDraft';
import { emptyPlan } from '../../src/data/seed.example';

const names: string[] = [];
afterEach(async () => { for (const name of names.splice(0)) await Dexie.delete(name); });
const stores = {
  plan: 'id', foods: 'id, name', entries: 'id, at, kind', wellbeing: 'date', workouts: 'id, date', weights: 'date',
  labs: '[date+name], name', recipes: 'id, name', sync: 'tid', meta: 'key', favorites: 'id, title',
  frictions: 'id, at', pieces: 'id', tally: 'day', pilot: 'key', moduleEvents: 'id, at, kind',
};
const draft: ReviewDraft = { id: REVIEW_ID, v: 1, revision: 'synthetic-revision', at: '2026-10-27T12:00:00Z',
  lines: [{ key: 'source', kind: 'unread', status: 'unread', text: 'Synthetic source' }],
  cuts: { source: 'data:image/png;base64,AA==' }, source: 'Synthetic document', note: 'Keep review' };

it.each(['photo', 'review', 'both'] as const)('preserves records when upgrading the %s v9 history to the current schema and reopening', async history => {
  const name = `migration-review-${crypto.randomUUID()}`; names.push(name);
  const old = new Dexie(name);
  old.version(8).stores(stores);
  old.version(9).stores({ ...(history !== 'review' ? { profile: 'key' } : {}), ...(history !== 'photo' ? { reviewDrafts: 'id' } : {}) });
  const plan = { ...emptyPlan(), id: 'main', questions: ['Synthetic question'] };
  await old.table('plan').put(plan);
  await old.table('entries').put({ id: 'water', kind: 'water', at: '2026-10-27T10:00:00Z', waterMl: 250 });
  await old.table('pieces').put({ id: 'source', url: 'data:image/png;base64,AA==', source: 'Synthetic', at: '2026-10-27' });
  if (history !== 'review') await old.table('profile').put({ key: 'self', jpeg: 'data:image/jpeg;base64,AA==' });
  if (history !== 'photo') await old.table('reviewDrafts').put(draft);
  old.close();
  const current = new ProtocolDB(name);
  try {
    for (let open = 0; open < 2; open++) {
      await current.open();
      expect(current.verno).toBe(11);
      expect(await current.plan.get('main')).toEqual(plan);
      expect((await current.entries.get('water'))?.waterMl).toBe(250);
      expect((await current.pieces.get('source'))?.source).toBe('Synthetic');
      expect(await current.profile.get('self')).toEqual(history === 'review' ? undefined : { key: 'self', jpeg: 'data:image/jpeg;base64,AA==' });
      expect(await current.reviewDrafts.get(REVIEW_ID)).toEqual(history === 'photo' ? undefined : draft);
      current.close();
    }
  } finally { current.close(); }
});
