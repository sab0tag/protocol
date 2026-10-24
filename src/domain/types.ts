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
  | 'allergy' // D58: an allergy confirmed by a doctor, with its allergens
  | 'diet' // D90: a diet of Наказ МОЗ №931 (a preset: its rules and reference norms), `diet` holds its code
  | 'custom';

export interface Constraint {
  id: string;
  tag: ConstraintTag;
  title: string;
  reason: string;
  source: string;
  active: boolean;
  allergens?: Allergen[]; // D58: for `allergy`
  diet?: string; // D90: for `diet` — the code («ЩД»)
  off?: string[]; // D90: for `diet` — ids of the preset's rules the person switched off
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
  /** D69: pieces left when counted (`at`), and pieces a dose — what remains is counted down by the ticks since */
  stock?: { left: number; perDose: number; at: ISODateTime };
  /** D97: the day it entered the plan — doses before it are not due (a medicine added today is not «missed» for two weeks) */
  since?: ISODate;
  /** D103: the time on `since` it entered the plan — doses of that first day before it are not due (taken before the app knew) */
  sinceTime?: string;
  /** D100: the last day of a course («14 днів» from the start) or the day it was cancelled — no doses after it; history stays */
  until?: ISODate;
  /** D100: taken when needed, not at set times — the only way a medicine is kept without a time */
  asNeeded?: true;
  /** D118: «не більше 4 на добу» — the doctor's daily limit for a medicine taken when needed */
  maxPerDay?: number;
  /** D89: picked from the medicines register — its trade name, INN and ATC (never a dose); absent = typed, «не з реєстру» */
  med?: { name: string; inn?: string; atc?: string };
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
  /** D21: the last visit to the doctor (the report starts from it) and «Мої питання» for the next one. */
  lastVisit?: ISODate;
  questions?: string[];
  /** D22: the last JSON export — the weekly reminder counts from it. */
  lastExportAt?: ISODate;
  /** D72: one goal for the week, chosen by the person on «Тиждень» */
  weekGoal?: { text: string; set: ISODate };
}

export interface Nutrients {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  calciumMg?: number;
}

/** D26: a household measure of a food — «шт», «ст. л.», «склянка» — and its approximate weight. */
export interface FoodUnit {
  name: string; // "шт", "ст. л.", "скибка"
  grams: number;
}

export interface Food {
  id: string;
  name: string;
  per100g: Nutrients;
  tags: string[]; // for the rules
  units?: FoodUnit[]; // D26: the first one is offered by default
  aliases?: string[]; // D26: other names to find it by ("грудка", "курка")
  custom?: boolean; // D36: the person's own food (from a free line or a photo), synced; the base is not
  allergens?: Allergen[]; // D57: typical composition for the base; ticked by the person for own foods
}

/** D57: the 14 allergens food labels must name (EU 1169/2011, Ukrainian rules follow it). */
export const ALLERGENS = ['gluten', 'milk', 'egg', 'fish', 'crustaceans', 'molluscs', 'peanut', 'nuts', 'soy', 'sesame', 'celery',
  'mustard', 'sulphites', 'lupin'] as const;
export type Allergen = (typeof ALLERGENS)[number];

/** D27: a dish made of foods — ingredients for one portion. */
export interface Recipe {
  id: string;
  name: string;
  aliases?: string[];
  items: MealItem[];
  builtIn?: boolean;
  /** D123: a draft from a list — only the name was given, «Потрібен склад»; no lines, no numbers, not in the meal search until made */
  needsMake?: true;
}

/** D67: «Що заважало» — a line for the week of trying the app on oneself: where a button was looked for, where a record
 *  had to be fixed, when nothing was written because it was too much hassle. */
export interface Friction {
  id: string;
  at: ISODateTime;
  kind: 'search' | 'fix' | 'skip' | 'other';
  text: string;
}

/** D51: «Мої звичні» — a meal the person pinned («Моя вівсянка», «Звичайний сніданок»); a tap adds its lines. */
export interface Favorite {
  id: string;
  title: string;
  items: MealItem[];
}

export type Cooking = 'raw' | 'boiled' | 'baked' | 'airfryer' | 'steamed' | 'stewed' | 'fried';

/** D111: what the model may say an estimated ingredient is — the words of the plan's own rules. */
export const EST_TAGS = ['lactose', 'cheese-aged', 'salty', 'fried', 'fatty', 'sweet', 'fast-carb', 'oxalate-high', 'calcium'] as const;
export type EstTag = (typeof EST_TAGS)[number];

export interface MealItem {
  foodId?: string;
  name: string;
  grams: number;
  cooking?: Cooking;
  /** A free line not from the food base: nutrients of the whole portion, entered by hand (SPEC.md §4, decision D1). */
  manual?: Nutrients;
  /** D26: entered in a household measure — 2 × «шт» of 50 g; `grams` = qty × grams stays the source of truth. */
  unit?: { name: string; qty: number; grams: number };
  /** D27: a dish — the recipe and how many portions; `components` are its ingredients as eaten (a copy, so
   *  editing the recipe later does not change history); `grams` = their sum. */
  recipe?: { id: string; portions: number; byGrams?: true }; // D106: said in grams («250 г гречки з куркою») — shown in grams
  /** D111: an ingredient the model estimated (not from the base) — what it is, marked by the model from a closed list, so the
   *  plan's check sees it; its allergens only ever add a warning, never clear one (the make-up is still not known) */
  est?: { tags: EstTag[]; allergens: Allergen[] };
  components?: MealItem[];
}

export type EntryKind = 'meal' | 'med' | 'water' | 'workout' | 'note' | 'symptom';
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
  symptoms?: string[]; // symptom (D56): «Мені погано» — what was felt, at `at`
  severity?: 1 | 2 | 3; // symptom: легко / помірно / сильно
  prescriptionId?: string; // med
  /** D18: which «Мій день» item this entry ticks (e.g. "med:p-vitd:08:30", "dinner", "mode:0"). */
  checkKey?: string;
  /** D79: a record of the example week — taken out with the example plan («Почати свій план»). */
  demo?: true;
  /** D33: a meal from «Меню на завтра» (replaced when a new menu is accepted while still planned); the day's
   *  practical tips ride on its first meal. */
  menu?: { tips?: string[] };
  /** D52: a mark made later is never given an invented time. `at` is the real time the person confirmed; with
   *  `timeUnknown` («час не пам'ятаю») it only keeps the place in the day and is shown as unknown. `markedAt` — when the
   *  mark was made; `plannedAt` — the plan's time of a meal marked at another time (a medicine's is in its `checkKey`). */
  timeUnknown?: true;
  markedAt?: ISODateTime;
  plannedAt?: ISODateTime;
  /** D119: how a meal was recorded — said in the voice window, or with lines from a photo of the plate; absent = typed or tapped */
  via?: 'voice' | 'photo';
}

export interface Wellbeing {
  date: ISODate;
  energy?: 1 | 2 | 3 | 4 | 5;
  mood?: 1 | 2 | 3 | 4 | 5;
  sleep?: 1 | 2 | 3 | 4 | 5;
  symptoms: string[];
  note?: string;
  demo?: true; // D79
}

export interface WorkoutSet {
  reps?: number;
  seconds?: number;
  side?: 'L' | 'R';
}
export interface WorkoutExercise {
  exerciseId?: string; // D60: from the library (src/data/exercises.ts); older workouts have the name only
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
  demo?: true; // D79
}

export interface WeightLog {
  date: ISODate;
  kg: number;
  demo?: true; // D79
}
export interface LabResult {
  date: ISODate;
  name: string;
  value: number;
  unit: string;
  target?: string;
  demo?: true; // D79
}
