// «Черновики норм для проверки врачом» («Очередь агента» 18.11, D196): every reference value the app uses where the doctor gave
// none, in one file, taken as written in the owner's queue. While `reviewedBy` is null each screen that shows one says
// «Чернетка — ще не перевірено лікарем» under the text. The owner checks them with doctors and edits the numbers here; Ukrainian
// МОЗ protocols are still to be compared separately. Never a doctor's number; never offered under the doctor's own limit.
export const NORMS = {
  reviewedBy: null as string | null,
  /** EFSA (2010): adequate total water intake 2.0 l women, 2.5 l men, food water included; drinks ≈ 80 % of it
   *  (the 80 % share to be confirmed with a doctor). Not shown under a doctor's fluid limit. */
  water: { source: 'EFSA', drinksMl: { female: 1600, male: 2000 } },
  /** The weight goal helper (D183) — AHA/ACC/TOS 2013 as summarised in Endotext. Resting energy by Mifflin–St Jeor (1990) ×
   *  an activity multiplier. */
  goal: {
    source: 'AHA/ACC/TOS 2013 (Endotext)',
    deficitKcal: [500, 750] as const, deficitDefault: 600, kcalFloor: 1200,
    /** The guideline's other method — fixed calories by body weight. NOT applied: the deficit method above is (task 8's control
     *  case, 97 kg → 1700–1900 kcal, would become 1500 under it). Which one — the owner's and the doctor's decision. */
    kcalBands: [{ upToKg: 114, kcal: [1200, 1500] as const }, { fromKg: 114, kcal: [1500, 1800] as const }],
    pacePerWeekKg: [0.5, 1.0] as const, firstStagePct: [5, 10] as const, firstStageMonths: 6,
    proteinPerKg: [1.2, 1.6] as const,
  },
  /** Stop conditions of the weight goal — ADA Standards of Care 2025, hypoglycaemia: insulins (A10A) and sulfonylureas (A10BB).
   *  Meglitinides (repaglinide, nateglinide) are not named in that source: kept in the stop list by caution until a doctor
   *  decides (`glinides`). Metformin alone is not a stop. */
  stopMeds: { atc: ['A10A', 'A10BB'] as const, glinides: true },
  /** After a cast / a fracture of the leg (NHS Fife, EKHUFT) — the red-flag cards' words live in rehabSafety.ts. The pain
   *  threshold after ЛФК is our proposal without a source — to be approved by a rehabilitation doctor. */
  rehab: { source: 'NHS Fife, EKHUFT', painStop: 7, risingDays: 3 },
} as const;

/** «Чернетка — ще не перевірено лікарем» is shown while this is true. */
export const normsDraft = () => NORMS.reviewedBy === null;
