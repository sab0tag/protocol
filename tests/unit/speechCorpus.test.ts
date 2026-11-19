// D175 (Soniox, PR 4): the experiment's corpus and its measure. Each reference reads as expected; each form an engine may
// write (digits, punctuation, capitals, Latin letters, apostrophes) reads the same as the reference; the verdict tells a
// harmless word from a dangerous difference; the report and the decision rule count as the spec says.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import corpusText from '../fixtures/speech-corpus.yaml?raw';
import { decide, judge, outcome, readPhrase, report, spokenNumbers, type CorpusPhrase, type SpeechRun } from '../../src/domain/speechCorpus';

const corpus = parse(corpusText) as CorpusPhrase[];
const byId = (id: string) => corpus.find((p) => p.id === id)!;

describe('the corpus', () => {
  it('40 phrases, unique ids, the groups of the spec', () => {
    expect(corpus).toHaveLength(40);
    expect(new Set(corpus.map((p) => p.id)).size).toBe(40);
    const n = (g: string) => corpus.filter((p) => p.group === g).length;
    expect([n('food-uk'), n('food-ru'), n('meds'), n('water'), n('commands'), n('questions')]).toEqual([14, 6, 8, 4, 6, 2]);
  });

  for (const p of corpus) {
    it(`${p.id}: the reference reads as expected, every form the same`, () => {
      const r = readPhrase(p.say, p.card), o = outcome(r);
      expect(r.kind, p.say).toBe(p.expect.kind);
      if (p.expect.meds) expect(o.slice(1), p.say).toEqual(p.expect.meds);
      if (p.expect.water_ml !== undefined) expect(o[1]).toBe(`${p.expect.water_ml} мл`);
      if (p.expect.items) {
        const lines = o.slice(1).filter((x) => !x.startsWith('вода '));
        expect(lines.length, `${p.say}: ${lines.join(' | ')}`).toBe(p.expect.items.length);
        p.expect.items.forEach((w, i) => expect(lines[i], p.say).toMatch(new RegExp(`^${w}`)));
      }
      if (r.kind === 'food') expect(o.filter((x) => x.startsWith('? ')), `${p.say}: nothing left unread`).toEqual([]);
      for (const f of p.forms ?? []) expect(outcome(readPhrase(f, p.card)), `«${f}» ≠ «${p.say}»`).toEqual(o);
    });
  }
});

describe('the numbers said', () => {
  it('words and digits are the same number; a different one is not', () => {
    expect(spokenNumbers('вітамін д дві тисячі')).toEqual([2000]);
    expect(spokenNumbers('Вітамін D 2000 МО')).toEqual([2000]);
    expect(spokenNumbers('Вітамін D, 2 000')).toEqual([2000]);
    expect(spokenNumbers('сіофор вісімсот п’ятдесят')).toEqual([850]);
    expect(spokenNumbers('пів літра')).toEqual([0.5]);
    expect(spokenNumbers('0,5 л')).toEqual([0.5]);
    expect(spokenNumbers('не два, а три яйця')).toEqual([2, 3]);
    expect(spokenNumbers('вітамін д двісті')).toEqual([200]);
  });
});

describe('the verdict: «the same would be written»', () => {
  it('a harmless spelling is the same', () => {
    expect(judge(byId('food-eggs-coffee'), '2 яйця і кава з молоком. Це все.')).toEqual({ same: true, dangerous: [] });
  });
  it('another number in a dose is dangerous even when the same medicine would be marked', () => {
    const v = judge(byId('med-vitd-2000'), 'Вітамін D 200, а ні, нічого');
    expect(v.dangerous).toContain('number');
  });
  it('another medicine is dangerous', () => {
    expect(judge(byId('med-metformin-plain'), 'випила еналаприл').dangerous).toContain('medicine');
  });
  it('a command heard as food is dangerous', () => {
    expect(judge(byId('cmd-undo'), 'скажи останнє').dangerous).toContain('command');
  });
});

describe('the report and the rule fixed before the run', () => {
  const run = (phrase: string, engine: SpeechRun['engine'], text: string, lat = 800, socketMs?: number): SpeechRun => ({
    phrase, engine, platform: 'ios-pwa', speaker: 'A', condition: 'тихо', text, startedAt: 0, lastWordAt: 1000, finalAt: 1000 + lat, endedAt: 1000 + lat,
    ...(socketMs !== undefined ? { socketMs } : {}),
  });
  const runs = [
    run('water-glass', 'soniox', 'Склянка води.', 600, 4000), run('med-vitd-2000', 'soniox', 'Вітамін D 2000.', 900, 5000),
    run('water-glass', 'browser', 'склянка води', 1200), run('med-vitd-2000', 'browser', 'вітамін д двісті', 1500),
    run('cmd-undo', 'browser', '', 0),
  ];
  it('match over every recording (a lost one is not a match), dangerous, lost, latency, socket seconds', () => {
    const rows = report(runs, corpus);
    expect(rows.find((r) => r.engine === 'soniox')).toEqual({ engine: 'soniox', platform: 'ios-pwa', runs: 2, matchPct: 100, dangerous: 0, lost: 0,
      latencyMedianMs: 750, latencyWorstMs: 900, socketSecondsPerPhrase: 4.5 });
    expect(rows.find((r) => r.engine === 'browser')).toMatchObject({ runs: 3, matchPct: 33.3, dangerous: 1, lost: 1, socketSecondsPerPhrase: null });
  });
  it('the rule: ≥ 90 %, no more dangerous than the phone, median ≤ 1.5 s — decided per platform', () => {
    expect(decide(report(runs, corpus))).toEqual([{ platform: 'ios-pwa', soniox: true, why: 'усі три умови виконано' }]);
    const slow = runs.map((r) => (r.engine === 'soniox' ? { ...r, finalAt: r.lastWordAt! + 2000 } : r));
    expect(decide(report(slow, corpus))[0]).toMatchObject({ soniox: false });
    expect(decide(report(runs.filter((r) => r.engine === 'soniox'), corpus))[0]).toMatchObject({ soniox: false, why: 'немає прогону обох рушіїв' });
  });
});
