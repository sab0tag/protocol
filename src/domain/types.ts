// Data model — the source of truth is SPEC.md §4. Change it there too.

export type ISODate = string; // "2026-10-04"
export type ISODateTime = string; // "2026-10-04T08:40:00+03:00"

export type ConstraintTag =
  | 'oxalate' // oxalate stones
  | 'gallbladder' // sludge / cholecystitis: nothing fried, slow weight loss
  | 'lactose' // lactose intolerance
  | 'glycemic' // impaired glycaemia / prediabetes
  | 'iron' // high ferritin
  | 'sodium' // salt restriction
  | 'custom';

export interface Constraint {
  id: string;
  tag: ConstraintTag;
  title: string;
  reason: string;
  source: string;
  active: boolean;
}

export interface Prescription {
  id: string;
  kind: 'medication' | 'supplement' | 'test' | 'lifestyle';
  title: string;
  dose?: string; // entered by the user from the doctor's words
  schedule?: { times: string[]; withFood?: boolean };
  dueDate?: ISODate; // for lab tests
  notes?: string;
  source: string;
}

export interface Targets {
  kcal?: number;
  proteinG?: number;
  carbsG?: { min?: number; max?: number };
  fatG?: number;
  calciumMg?: number;
  waterMl?: number;
  lastMealBy?: string; // "20:00"
  weightGoalKg?: number;
  maxWeightLossKgPerWeek?: number;
}

/** A temporary mode that overrides targets (e.g. preparing for an OGTT). */
export interface Mode {
  id: string;
  title: string;
  from: ISODate;
  to: ISODate;
  targetsOverride: Partial<Targets>;
  notes: string[];
}

export interface Plan {
  constraints: Constraint[];
  prescriptions: Prescription[];
  targets: Targets;
  modes: Mode[];
  nextCheckup?: { date: ISODate; tests: string[] };
  /** D17: «про себе» from onboarding. */
  profile?: { heightCm?: number };
  /** D17: set when onboarding was finished or skipped; until then it opens on start. */
  onboardedAt?: ISODate;
}

export interface Nutrients {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  calciumMg?: number;
}

export interface Food {
  id: string;
  name: string;
  per100g: Nutrients;
  tags: string[]; // for the rules
}

export type Cooking = 'raw' | 'boiled' | 'baked' | 'airfryer' | 'steamed' | 'stewed' | 'fried';

export interface MealItem {
  foodId?: string;
  name: string;
  grams: number;
  cooking?: Cooking;
  /** A free line not from the food base: nutrients of the whole portion, entered by hand (SPEC.md §4, decision D1). */
  manual?: Nutrients;
}

export type EntryKind = 'meal' | 'med' | 'water' | 'workout' | 'note';
export type EntryStatus = 'planned' | 'done' | 'skipped';

export interface DayEntry {
  id: string;
  at: ISODateTime;
  kind: EntryKind;
  status: EntryStatus;
  title: string;
  items?: MealItem[]; // meal
  waterMl?: number; // water
  workoutId?: string; // workout
  prescriptionId?: string; // med
  /** D18: which «Мій день» item this entry ticks (e.g. "med:p-vitd:08:30", "dinner", "mode:0"). */
  checkKey?: string;
}

export interface Wellbeing {
  date: ISODate;
  energy?: 1 | 2 | 3 | 4 | 5;
  mood?: 1 | 2 | 3 | 4 | 5;
  sleep?: 1 | 2 | 3 | 4 | 5;
  symptoms: string[];
  note?: string;
}

export interface WorkoutSet {
  reps?: number;
  seconds?: number;
  side?: 'L' | 'R';
}
export interface WorkoutExercise {
  name: string;
  target: string;
  sets: WorkoutSet[];
}
export interface Workout {
  id: string;
  date: ISODate;
  durationMin: number;
  equipment: string;
  exercises: WorkoutExercise[];
  feeling?: string;
}

export interface WeightLog {
  date: ISODate;
  kg: number;
}
export interface LabResult {
  date: ISODate;
  name: string;
  value: number;
  unit: string;
  target?: string;
}
