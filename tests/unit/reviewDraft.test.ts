import { afterEach, describe, expect, it } from 'vitest';
import { ProtocolDB, ensureSeeded } from '../../src/data/db';
import { storeReview, discardReview, REVIEW_ID, type ReviewContent } from '../../src/data/reviewDraft';
import { exportAll } from '../../src/data/backup';
const databases: ProtocolDB[] = [];
const make = () => { const d = new ProtocolDB(`review-test-${crypto.randomUUID()}`); databases.push(d); return d; };
afterEach(async () => { for (const d of databases.splice(0)) await d.delete(); });
const content: ReviewContent = { lines: [{ key: 'note', kind: 'unread', status: 'unread', text: 'Synthetic source' }], cuts: { note: 'data:image/png;base64,AA==' }, source: 'Synthetic document', note: 'Check this' };
describe('durable local review', () => {
  it('survives a database restart and never appears in clinical backup', async () => {
    const d = make(); await ensureSeeded(d);
    const revision = await storeReview(d, content); d.close(); await d.open();
    expect(await d.reviewDrafts.get(REVIEW_ID)).toMatchObject({ ...content, v: 1, revision });
    expect(JSON.stringify(await exportAll(d))).not.toContain('Synthetic source');
    expect(await d.entries.count()).toBe(0);
  });
  it('rejects stale writes and stale deletion, retaining the newer review', async () => {
    const d = make(); const a = await storeReview(d, content);
    const b = await storeReview(d, { ...content, note: 'Newer' }, a);
    await expect(storeReview(d, { ...content, note: 'Stale' }, a)).rejects.toThrow('review_conflict');
    await expect(discardReview(d, a)).rejects.toThrow('review_conflict');
    expect(await d.reviewDrafts.get(REVIEW_ID)).toMatchObject({ revision: b, note: 'Newer' });
    await discardReview(d, b); expect(await d.reviewDrafts.count()).toBe(0);
  });
  it('rolls back draft consumption when activation fails, then commits both exactly once', async () => {
    const d = make(); await ensureSeeded(d); const revision = await storeReview(d, content);
    const before = await d.plan.get('main');
    await expect(d.transaction('rw', d.plan, d.reviewDrafts, async () => {
      await discardReview(d, revision); await d.plan.update('main', { questions: ['Synthetic activation'] });
      throw new Error('storage failure');
    })).rejects.toThrow('storage failure');
    expect((await d.reviewDrafts.get(REVIEW_ID))?.revision).toBe(revision);
    expect(await d.plan.get('main')).toEqual(before);
    await d.transaction('rw', d.plan, d.reviewDrafts, async () => {
      await discardReview(d, revision); await d.plan.update('main', { questions: ['Synthetic activation'] });
    });
    expect(await d.reviewDrafts.count()).toBe(0);
    expect((await d.plan.get('main'))?.questions).toEqual(['Synthetic activation']);
    await expect(discardReview(d, revision)).rejects.toThrow('review_conflict');
  });
  it('does not share drafts between profile databases', async () => {
    const own = make(), relative = make(); await storeReview(own, content);
    expect(await relative.reviewDrafts.count()).toBe(0);
  });
});
