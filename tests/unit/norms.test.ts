// D196: «Черновики норм» — one file, reviewedBy null → «Чернетка» on screen; the modules read their numbers from it.
import { describe, expect, it } from 'vitest';
import { NORMS, normsDraft } from '../../src/domain/norms';
import { DEFICIT_DEFAULT, KCAL_FLOOR } from '../../src/domain/weightGoal';
import { PAIN_STOP, RED_FLAGS_SIGNED } from '../../src/domain/rehabSafety';

describe('draft norms (one file)', () => {
  it('not reviewed yet — every screen says «Чернетка»', () => {
    expect(NORMS.reviewedBy).toBeNull();
    expect(normsDraft()).toBe(true);
    expect(RED_FLAGS_SIGNED).toBe(false);
  });
  it('the modules take their numbers from it', () => {
    expect(KCAL_FLOOR).toBe(NORMS.goal.kcalFloor);
    expect(DEFICIT_DEFAULT).toBe(NORMS.goal.deficitDefault);
    expect(PAIN_STOP).toBe(NORMS.rehab.painStop);
  });
  it('the guideline\'s calorie bands are recorded, not applied (the owner and the doctor choose the method)', () => {
    expect(NORMS.goal.kcalBands.map((b) => b.kcal)).toEqual([[1200, 1500], [1500, 1800]]);
  });
});
