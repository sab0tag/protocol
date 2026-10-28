import type { Expected } from './metrics.ts';

/** Fully synthetic documents. Real patient documents must never be added here (spec §4.4, §6.2). */
export interface EvalCase {
  id: string;
  synthetic: true;
  language: 'uk' | 'en';
  features: readonly ('simple' | 'multi_drug' | 'complex_dose' | 'units' | 'multi_intake' | 'illegible' | 'contradictory' | 'multi_page')[];
  /** Text rendering of the invented document; image fixtures can be attached under the same id. */
  document: string;
  pages: number;
  expected: Expected;
}

const med = (title: string, dose: string | null, perDay: number | null, durationDays: number | null) => ({ title, dose, perDay, durationDays });

export const SYNTHETIC_DATASET: readonly EvalCase[] = [
  { id: 'simple-uk', synthetic: true, language: 'uk', features: ['simple'], pages: 1,
    document: 'Тестовий пацієнт. Вигаданий препарат Тестол 500 мг, 2 рази на день, 14 днів.',
    expected: { medications: [med('Тестол', '500 мг', 2, 14)], constraints: [] } },
  { id: 'multi-drug-uk', synthetic: true, language: 'uk', features: ['multi_drug'], pages: 1,
    document: 'Вигадані: Альфазол 10 мг 1 раз на день 30 днів; Бетаквін 250 мг 3 рази на день 7 днів; Гаммавіт 1 табл. 1 раз на день.',
    expected: { medications: [med('Альфазол', '10 мг', 1, 30), med('Бетаквін', '250 мг', 3, 7), med('Гаммавіт', '1 табл.', 1, null)], constraints: [] } },
  { id: 'complex-dose-en', synthetic: true, language: 'en', features: ['complex_dose'], pages: 1,
    document: 'Fictional: Deltaprine 2.5 mg morning and 5 mg evening for 10 days.',
    expected: { medications: [med('Deltaprine', '2.5 mg + 5 mg', 2, 10)], constraints: [] } },
  { id: 'units-uk', synthetic: true, language: 'uk', features: ['units'], pages: 1,
    document: 'Вигаданий вітамін Епсілон 2000 МО на добу, тривало. Тестрин 0,5 г двічі на день 5 днів.',
    expected: { medications: [med('Епсілон', '2000 МО', 1, null), med('Тестрин', '0.5 г', 2, 5)], constraints: [] } },
  { id: 'multi-intake-uk', synthetic: true, language: 'uk', features: ['multi_intake', 'multi_drug'], pages: 1,
    document: 'Дзетокс 1 капс. зранку, 1 вдень, 1 ввечері, 21 день. Алергія на молоко та яйця.',
    expected: { medications: [med('Дзетокс', '1 капс.', 3, 21)], constraints: [{ tag: 'allergy', allergens: ['milk', 'egg'] }] } },
  { id: 'illegible-en', synthetic: true, language: 'en', features: ['illegible'], pages: 1,
    document: 'Fictional: Etalon [smudged] mg twice daily. Second line unreadable.',
    expected: { medications: [med('Etalon', null, 2, null)], constraints: [] } },
  { id: 'contradictory-uk', synthetic: true, language: 'uk', features: ['contradictory'], pages: 1,
    document: 'Тетразин 100 мг 1 раз на день ... нижче: Тетразин 100 мг 2 рази на день. Обмеження: лактоза.',
    expected: { medications: [med('Тетразин', '100 мг', 1, null)], constraints: [{ tag: 'lactose', allergens: [] }] } },
  { id: 'multi-page-uk', synthetic: true, language: 'uk', features: ['multi_page', 'multi_drug'], pages: 3,
    document: 'Стор.1: Йотарин 5 мг 1 раз. Стор.2: Каппазол 20 мг 2 рази 14 днів. Стор.3: дієта без глютену.',
    expected: { medications: [med('Йотарин', '5 мг', 1, null), med('Каппазол', '20 мг', 2, 14)], constraints: [{ tag: 'allergy', allergens: ['gluten'] }] } },
  { id: 'bilingual-en', synthetic: true, language: 'en', features: ['multi_drug', 'units'], pages: 1,
    document: 'Fictional: Lambdex 40 mg once daily 90 days; Mutrin 1 tab twice daily as directed.',
    expected: { medications: [med('Lambdex', '40 mg', 1, 90), med('Mutrin', '1 tab', 2, null)], constraints: [] } },
];
