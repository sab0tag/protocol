// D196/D197: the draft norms — one file, a review per norm (who, date, the source's version), «Чернетка» while unreviewed; the
// modules read their numbers from it; the doctors' sheets by specialty are made from it and docs/norms/ never drifts from it.
import { describe, expect, it } from 'vitest';
import { kcalFloor, NORM_IDS, NORMS, normDraft, normsDraft, normsFor, SPECIALTIES, type NormMeta, type Specialty } from '../../src/domain/norms';
import { normsSheet, sheetNorms } from '../../src/domain/normsSheet';
import { DEFICIT_DEFAULT, goalPlan, stopReasons } from '../../src/domain/weightGoal';
import { PAIN_STOP, RED_FLAGS_SIGNED } from '../../src/domain/rehabSafety';
import { emptyPlan } from '../../src/data/seed.example';

const docs = import.meta.glob('../../docs/norms/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('draft norms (one file, a review per norm)', () => {
  it('none reviewed yet — every screen says «Чернетка»', () => {
    for (const id of NORM_IDS) expect(normDraft(id), id).toBe(true);
    expect(normsDraft()).toBe(true);
    expect(RED_FLAGS_SIGNED).toBe(false);
  });
  it('a review holds for the source version it was made against — a newer source makes it a draft again', () => {
    const n = (review: NormMeta['review']): NormMeta => ({ ...NORMS.kcalFloor, review });
    const draft = (m: NormMeta) => !m.review || (m.source !== null && m.review.sourceVersion !== m.source.version);
    expect(draft(n({ by: 'Лікар', date: '2026-11-21', sourceVersion: NORMS.kcalFloor.source.version }))).toBe(false);
    expect(draft(n({ by: 'Лікар', date: '2026-11-21', sourceVersion: '2010' }))).toBe(true);
  });
  it('every norm says what, where and for whom; a source has a version', () => {
    for (const id of NORM_IDS) {
      const m: NormMeta = NORMS[id];
      expect(m.title && m.says && m.usedIn, id).toBeTruthy();
      expect(m.specialties.length, id).toBeGreaterThan(0);
      if (m.source) expect(m.source.version, id).toBeTruthy();
    }
  });
  it('the modules take their numbers from it', () => {
    expect(DEFICIT_DEFAULT).toBe(NORMS.deficit.default);
    expect(PAIN_STOP).toBe(NORMS.rehabPain.painStop);
  });
});

describe('calories: the deficit method; the band by sex only as the lower limit (owner 20.11)', () => {
  it('women not below 1200, men not below 1500 — less only by a doctor', () => {
    expect([kcalFloor('female'), kcalFloor('male')]).toEqual([1200, 1500]);
    const man = goalPlan({ sex: 'male', age: 70, heightCm: 160, weightKg: 62, goalKg: 58 }, emptyPlan(), '2026-11-20');
    expect(man.kcal).toBe(1500);
    expect(man.floored).toBe(true);
  });
  it('no weight bands: 114 kg is Look AHEAD, not a norm', () => {
    expect(JSON.stringify(NORMS)).not.toMatch(/upToKg|fromKg/);
    expect(NORMS.kcalFloor.note).toMatch(/Look AHEAD/);
  });
  it('meglitinides stay a stop, with ADA Standards of Care 2025, section 6 as the source', () => {
    expect(NORMS.stopMeds.source.cite).toMatch(/Standards of Care in Diabetes—2025/);
    expect(NORMS.stopMeds.source.url).toBe('https://doi.org/10.2337/dc25-S006');
    const med = (atc: string) => ({ ...emptyPlan(), prescriptions: [{ id: 'm', kind: 'medication' as const, title: 'X', med: { atc } }] });
    expect(stopReasons(med('A10BX02') as never, {})).toContain('glucose-lowering');
    expect(stopReasons(med('A10BA02') as never, {})).not.toContain('glucose-lowering'); // metformin
  });
});

describe('the sheets for doctors, by specialty', () => {
  it('every norm reaches at least one specialty; every specialty has a sheet', () => {
    const covered = new Set((Object.keys(SPECIALTIES) as Specialty[]).flatMap(normsFor));
    expect([...covered].sort()).toEqual([...NORM_IDS].sort());
    for (const s of Object.keys(SPECIALTIES) as Specialty[]) expect(sheetNorms(s).length, s).toBeGreaterThan(0);
  });
  it('a sheet carries the source, its version and the review state, and a place for the doctor’s decision', () => {
    const text = normsSheet('endocrinologist');
    expect(text).toContain('Ендокринолог');
    expect(text).toContain('Версія: 2025');
    expect(text).toContain('Чернетка — ще не перевірено лікарем.');
    expect(text).toContain('ПІБ, дата, версія джерела');
  });
  it('docs/norms/ is the code’s own export (`npm run norms:export`)', () => {
    for (const s of Object.keys(SPECIALTIES) as Specialty[]) expect(docs[`../../docs/norms/${s}.md`], s).toBe(normsSheet(s));
    expect(Object.keys(docs).length).toBe(Object.keys(SPECIALTIES).length);
  });
});
