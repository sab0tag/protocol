// «Черновики норм для проверки врачом» (D196), one norm at a time (D197). Every reference value the app uses where the doctor
// gave none lives here — with its source and the source's version, the specialties that check it, and its own review: who,
// when, against which version of the source. A norm is a draft — «Чернетка — ще не перевірено лікарем» on each screen that uses
// it — until it is reviewed, and again when its source gets a newer version than the one it was checked against. A doctor's own
// number always wins; a norm is never offered under the doctor's limit. The sheets for doctors (`normsSheet`, «Для лікарів і
// клінік» → «Норми застосунку», docs/norms/) are made from this file alone.

export type Specialty = 'endocrinologist' | 'dietitian' | 'family' | 'nephrologist' | 'rehab' | 'traumatologist';
export const SPECIALTIES: Record<Specialty, string> = {
  endocrinologist: 'Ендокринолог', dietitian: 'Дієтолог', family: 'Сімейний лікар / терапевт', nephrologist: 'Нефролог',
  rehab: 'Лікар фізичної та реабілітаційної медицини', traumatologist: 'Травматолог-ортопед',
};

/** Where a number comes from: the citation, the version (edition / year) it was taken from, a link. */
export interface Source { cite: string; version: string; url?: string }
/** Who checked a norm, the day, and the version of the source they checked it against. */
export interface Review { by: string; date: string; sourceVersion: string }
export interface NormMeta {
  /** for the doctor's sheet: what it is, the value in words, where the app uses it */
  title: string; says: string; usedIn: string;
  /** null — our own proposal, no source: the doctor decides */
  source: Source | null; note?: string;
  specialties: readonly Specialty[];
  review: Review | null;
}

const EFSA_WATER: Source = { cite: 'EFSA Panel on Dietetic Products, Nutrition and Allergies. Scientific Opinion on Dietary Reference Values for water. EFSA Journal 2010;8(3):1459', version: '2010', url: 'https://doi.org/10.2903/j.efsa.2010.1459' };
const AHA_2013: Source = { cite: 'Jensen MD et al. 2013 AHA/ACC/TOS Guideline for the Management of Overweight and Obesity in Adults. Circulation 2014;129(25 Suppl 2):S102–S138', version: '2013 (друк 2014)', url: 'https://doi.org/10.1161/01.cir.0000437739.71477.ee' };
const ADA_2025_S6: Source = { cite: 'American Diabetes Association Professional Practice Committee. 6. Glycemic Goals and Hypoglycemia: Standards of Care in Diabetes—2025. Diabetes Care 2025;48(Suppl 1):S128–S145', version: '2025', url: 'https://doi.org/10.2337/dc25-S006' };
const NHS_CAST: Source = { cite: 'Пам’ятки для пацієнтів після перелому / з гіпсом: NHS Fife; East Kent Hospitals University NHS Foundation Trust (EKHUFT)', version: 'версію пам’яток не записано — уточнити' };

export const NORMS = {
  water: {
    title: 'Орієнтир води, коли лікар норму не задав',
    says: 'Напої: жінки — 1,6 л, чоловіки — 2,0 л на день (≈ 80 % загального споживання води 2,0 / 2,5 л, решта — з їжею). Людина сама обирає орієнтир; при обмеженні рідини від лікаря не показується.',
    usedIn: 'Вода на «Сьогодні», коли в плані немає норми води.',
    source: EFSA_WATER, note: 'Частку напоїв 80 % узято як оцінку — підтвердьте.',
    specialties: ['family', 'nephrologist'], review: null,
    drinksMl: { female: 1600, male: 2000 },
  },
  deficit: {
    title: 'Дефіцит калорій для власної цілі щодо ваги',
    says: 'Основний метод: витрата (Міффлін — Сан-Жеор × активність, порахована з кроків і хвилин тренувань) мінус 500–750 ккал на день; за замовчуванням 600. Менше 500 — лише свідомо, з поясненням, що результат буде повільним.',
    usedIn: 'Помічник цілі щодо ваги («Мій план» → «Моя ціль»): лише власна ціль людини, не призначення.',
    source: AHA_2013, note: 'Енерговитрата у спокої — Mifflin MD et al., Am J Clin Nutr 1990;51(2):241–247.',
    specialties: ['dietitian', 'endocrinologist'], review: null,
    kcal: [500, 750] as const, default: 600,
  },
  kcalFloor: {
    title: 'Нижня межа калорій',
    says: 'Жінки — не нижче 1200 ккал на день, чоловіки — не нижче 1500 (нижні межі смуг 1200–1500 і 1500–1800 з настанови). Смуга — лише нижня межа для методу дефіциту; нижче неї застосунок нічого не пропонує: менше — лише за призначенням лікаря.',
    usedIn: 'Помічник цілі щодо ваги і підказка при плато.',
    source: AHA_2013, note: 'Поділ «до / від 114 кг» — з протоколу дослідження Look AHEAD, а не загальна норма; застосунок його не використовує.',
    specialties: ['dietitian', 'endocrinologist'], review: null,
    kcal: { female: 1200, male: 1500 }, band: { female: [1200, 1500] as const, male: [1500, 1800] as const },
  },
  pace: {
    title: 'Найшвидший темп схуднення',
    says: 'Не швидше за 1 кг на тиждень: дефіцит 500–750 ккал дає ≈ 0,5–0,7 кг; темп не прискорюється понад 1 кг.',
    usedIn: 'Помічник цілі щодо ваги: тижні до цілі й дата.',
    source: null, note: 'Межу 1 кг на тиждень записано як поширену практику, без первинного джерела.',
    specialties: ['dietitian', 'endocrinologist'], review: null,
    maxKgPerWeek: 1,
  },
  firstStage: {
    title: 'Перший етап',
    says: 'Перший етап — мінус 5–10 % від початкової ваги за 6 місяців.',
    usedIn: 'Помічник цілі щодо ваги: пояснення, чого чекати.',
    source: AHA_2013, specialties: ['dietitian', 'endocrinologist'], review: null,
    pct: [5, 10] as const, months: 6,
  },
  protein: {
    title: 'Білок під час схуднення',
    says: '1,2–1,6 г на кг ваги на день; в поясненні застосунок пише «діапазон варто підтвердити в лікаря».',
    usedIn: 'Помічник цілі щодо ваги.',
    source: null, note: 'Без первинного джерела. При хворобі нирок помічник не рахує нічого (умова зупинки) — перевірте й цю межу.',
    specialties: ['dietitian', 'nephrologist'], review: null,
    perKg: [1.2, 1.6] as const,
  },
  stopMeds: {
    title: 'Ліки, з якими застосунок не рахує дефіцит калорій',
    says: 'Інсуліни (ATC A10A), похідні сульфонілсечовини (A10BB) і меглітиніди — репаглінід, натеглінід (A10BX02, A10BX03): «ціль щодо ваги — спершу з лікарем». Метформін сам по собі — не зупинка.',
    usedIn: 'Помічник цілі щодо ваги: умови зупинки.',
    source: ADA_2025_S6, note: 'Розділ 6: ризик гіпоглікемії — у людей на інсуліні, сульфонілсечовині чи меглітинідах. Вийшло видання 2026 (Diabetes Care 2026;49(Suppl 1), doi 10.2337/dc26-S006) — звірте з ним.',
    specialties: ['endocrinologist'], review: null,
    atc: ['A10A', 'A10BB', 'A10BX02', 'A10BX03'] as const,
  },
  rehabPain: {
    title: 'Біль після ЛФК, за якого застосунок радить зупинитись',
    says: 'Біль 7 і більше з 10 після заняття → картка «Зупиніть ці вправи і зателефонуйте лікарю».',
    usedIn: 'Заняття ЛФК, відмітка болю.',
    source: null, note: 'Наша пропозиція без джерела.',
    specialties: ['rehab'], review: null,
    painStop: 7,
  },
  rehabRising: {
    title: 'Біль, що росте кілька днів поспіль',
    says: 'Найбільший біль дня росте 3 дні поспіль → та сама картка.',
    usedIn: 'Заняття ЛФК, відмітка болю.',
    source: null, note: 'Наша пропозиція без джерела.',
    specialties: ['rehab'], review: null,
    days: 3,
  },
  redFlags: {
    title: 'Червоні прапорці з гіпсом, після перелому чи операції',
    says: 'Біль під гіпсом чи пов’язкою посилюється; пальці німіють, синіють, бліднуть або холодні; литка болить і набрякла; задишка або біль у грудях → картка 103. Тексти — статичні, не від моделі.',
    usedIn: 'Заняття ЛФК і «Помічник», коли в плані є комплекс ЛФК або обмеження тренувань від лікаря.',
    source: NHS_CAST, specialties: ['traumatologist', 'rehab'], review: null,
  },
} as const satisfies Record<string, NormMeta & Record<string, unknown>>;

export type NormId = keyof typeof NORMS;
export const NORM_IDS = Object.keys(NORMS) as NormId[];
const meta = (id: NormId): NormMeta => NORMS[id];

/** A draft: not reviewed, or reviewed against an older version of its source than the one written here. */
export const normDraft = (id: NormId): boolean => {
  const n = meta(id);
  return !n.review || (n.source !== null && n.review.sourceVersion !== n.source.version);
};
/** «Чернетка — ще не перевірено лікарем» is shown while any of these norms (all of them, if none named) is a draft. */
export const normsDraft = (...ids: NormId[]): boolean => (ids.length ? ids : NORM_IDS).some(normDraft);
export const normsFor = (s: Specialty): NormId[] => NORM_IDS.filter((id) => meta(id).specialties.includes(s));

/** The lower calorie limit by sex: below it the app offers nothing — less only by a doctor's prescription. */
export const kcalFloor = (sex: 'male' | 'female'): number => NORMS.kcalFloor.kcal[sex];
