// «Черновики норм» («Очередь агента» 18.11): reference values the app offers where the doctor gave none. Taken as written in
// the owner's queue, to be checked by a doctor before the first real person. While `reviewedBy` is null the screen says
// «Чернетка — ще не перевірено лікарем» under the text. Never a doctor's number; never offered under the doctor's limit.
export const NORMS = {
  reviewedBy: null as string | null,
  /** EFSA (2010): adequate total water intake 2.0 l women, 2.5 l men, food water included; drinks ≈ 80 % of it
   *  (the 80 % share to be confirmed with a doctor). */
  water: { source: 'EFSA', drinksMl: { female: 1600, male: 2000 } },
} as const;
