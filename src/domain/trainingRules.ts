// D178 (task 7, step 4): three training modes and the doctor's limits as a structure. Which mode is on is decided by the
// plan, not by the library or the model: a rehabilitation complex — «Реабілітація» (step 5); an active limit —
// «Обмеження»; nothing — general activity, as before. The filter is code and runs before any model: what a limit forbids
// is hidden from the library and the composer and never reaches the request. The old text constraints stay shown and are
// not filtered by (nobody parses free words into a rule).
import type { BodyPart, ISODate, Plan, Restriction } from './types';
import type { Exercise } from '../data/exercises';

/** What an exercise asks of the body: the parts it loads, whether the person stands on the legs, whether it is ballistic. */
export interface ExerciseBody { loads: BodyPart[]; standing: boolean; impact: boolean }

const LEGS: BodyPart[] = ['left-leg', 'right-leg'], ARMS: BodyPart[] = ['left-arm', 'right-arm'];
const all = (...xs: BodyPart[][]) => [...new Set(xs.flat())];
/** Every library exercise, tagged — when in doubt, as loading (a held bell loads the spine). Unilateral ones alternate sides,
 *  so they load both. A test checks none is missing. */
export const EXERCISE_BODY: Record<string, ExerciseBody> = {
  'goblet-squat': { loads: all(LEGS, ARMS, ['back']), standing: true, impact: false },
  'kb-deadlift': { loads: all(LEGS, ARMS, ['back']), standing: true, impact: false },
  row: { loads: all(ARMS, ['back'], LEGS), standing: true, impact: false },
  press: { loads: all(ARMS, ['back'], LEGS), standing: true, impact: false },
  plank: { loads: all(ARMS, ['back'], LEGS), standing: false, impact: false },
  'glute-bridge': { loads: all(LEGS, ['back']), standing: false, impact: false },
  halo: { loads: all(ARMS, ['neck', 'back'], LEGS), standing: true, impact: false },
  'floor-press': { loads: all(ARMS), standing: false, impact: false },
  'suitcase-carry': { loads: all(LEGS, ARMS, ['back']), standing: true, impact: false },
  swing: { loads: all(LEGS, ARMS, ['back']), standing: true, impact: true },
  'reverse-lunge': { loads: all(LEGS, ARMS, ['back']), standing: true, impact: false }, // a held bell loads the spine
  clean: { loads: all(LEGS, ARMS, ['back']), standing: true, impact: true },
  'sl-deadlift': { loads: all(LEGS, ARMS, ['back']), standing: true, impact: false },
  'push-press': { loads: all(LEGS, ARMS, ['back']), standing: true, impact: true },
  'high-pull': { loads: all(LEGS, ARMS, ['back']), standing: true, impact: true },
  'rack-carry': { loads: all(LEGS, ARMS, ['back']), standing: true, impact: false },
  'swing-1': { loads: all(LEGS, ARMS, ['back']), standing: true, impact: true },
  snatch: { loads: all(LEGS, ARMS, ['back']), standing: true, impact: true },
  'get-up': { loads: all(LEGS, ARMS, ['back', 'neck']), standing: true, impact: false },
  windmill: { loads: all(LEGS, ARMS, ['back']), standing: true, impact: false },
  'rack-squat': { loads: all(LEGS, ARMS, ['back']), standing: true, impact: false },
  'clean-press': { loads: all(LEGS, ARMS, ['back']), standing: true, impact: true },
  'bottoms-up-press': { loads: all(ARMS, ['back'], LEGS), standing: true, impact: false },
};

export type TrainingMode = 'general' | 'restricted' | 'rehab';

/** The limits that hold on that day: switched on and not past their last day. */
export const activeRestrictions = (plan: Pick<Plan, 'restrictions'> | undefined, date: ISODate): Restriction[] =>
  (plan?.restrictions ?? []).filter((r) => r.active && (!r.until || r.until >= date));

export function trainingMode(plan: Pick<Plan, 'restrictions'> | undefined, date: ISODate): TrainingMode {
  return activeRestrictions(plan, date).length ? 'restricted' : 'general';
}

/** The limit an exercise breaks, or null. «До N кг» limits the weight, not the exercise — it is said, not filtered. */
export function breaks(ex: Pick<Exercise, 'id'>, rs: Restriction[]): Restriction | null {
  const b = EXERCISE_BODY[ex.id];
  for (const r of rs) {
    if (!b) return r; // an untagged exercise is not shown while a limit holds — never guessed safe
    if (r.kind === 'no-weight-bearing' && r.part && (LEGS.includes(r.part) ? b.standing || b.loads.includes(r.part) : b.loads.includes(r.part))) return r;
    if (r.kind === 'no-load' && r.part && b.loads.includes(r.part)) return r;
    if (r.kind === 'max-pulse' && b.impact) return r; // ballistic work drives the pulse up — out under a pulse limit
  }
  return null;
}

/** The library as the plan allows it on that day, and what was hidden. */
export function allowedExercises<T extends Pick<Exercise, 'id'>>(list: T[], plan: Pick<Plan, 'restrictions'> | undefined, date: ISODate): { list: T[]; hidden: number; limits: Restriction[] } {
  const rs = activeRestrictions(plan, date);
  if (!rs.length) return { list, hidden: 0, limits: [] };
  const ok = list.filter((e) => !breaks(e, rs));
  return { list: ok, hidden: list.length - ok.length, limits: rs };
}

const PART: Record<BodyPart, string> = { 'left-leg': 'ліву ногу', 'right-leg': 'праву ногу', 'left-arm': 'ліву руку', 'right-arm': 'праву руку', back: 'спину', neck: 'шию' };
const PART_ON: Record<BodyPart, string> = { 'left-leg': 'лівій нозі', 'right-leg': 'правій нозі', 'left-arm': 'лівій руці', 'right-arm': 'правій руці', back: 'спині', neck: 'шиї' };
const dm = (d: ISODate) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
/** The limit in words, as the doctor would say it: «без опори на ліву ногу до 09.12», «пульс до 110». */
export function restrictionText(r: Restriction): string {
  const what = r.kind === 'no-weight-bearing' ? `без опори на ${PART[r.part ?? 'left-leg']}`
    : r.kind === 'no-load' ? `без навантаження на ${PART[r.part ?? 'back']}`
    : r.kind === 'max-kg' ? `вага до ${r.value ?? '?'} кг${r.part ? ` на ${PART_ON[r.part]}` : ''}`
    : `пульс до ${r.value ?? '?'}`;
  return r.until ? `${what} до ${dm(r.until)}` : what;
}
export const BODY_PARTS = Object.keys(PART) as BodyPart[];
export const partName = (p: BodyPart) => PART[p];
