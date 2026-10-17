// A photo of a doctor's conclusion → a draft of the plan (SPEC.md D80). The model copies what is written — limits,
// medicines with their doses, targets, tests to take, the next visit — and nothing else: no advice, no reading between
// the lines, no times that are not on the paper (D52). The app shows every line unticked; the person checks it against
// the paper and ticks what goes into «План». Names and other personal data on the form are not copied.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { structured, type Effort, type Usage } from './claude.ts';

const TAGS = ['oxalate', 'gallbladder', 'lactose', 'glycemic', 'iron', 'sodium', 'allergy', 'custom'] as const;
const ALLERGENS = ['gluten', 'milk', 'egg', 'fish', 'crustaceans', 'molluscs', 'peanut', 'nuts', 'soy', 'sesame', 'celery',
  'mustard', 'sulphites', 'lupin'] as const;

export const ConclusionResult = z.object({
  readable: z.boolean().describe('Чи це висновок / рекомендації лікаря і чи вдалося його прочитати'),
  date: z.string().nullable().describe('Дата висновку, YYYY-MM-DD; null, якщо не видно'),
  doctor: z.string().nullable().describe('Спеціальність лікаря, напр. «Ендокринолог»; без імені; null, якщо не видно'),
  constraints: z.array(z.object({
    tag: z.enum(TAGS).describe('oxalate — оксалатні камені/сечокам’яна; gallbladder — жовчний міхур, сладж; lactose — непереносимість лактози; glycemic — порушена глікемія, предіабет, діабет; iron — високий феритин/залізо; sodium — обмеження солі; allergy — алергія на продукт; custom — інше обмеження в їжі'),
    title: z.string().describe('Коротка назва, як у висновку: «Непереносимість лактози»'),
    reason: z.string().describe('Що саме сказано про їжу, коротко словами висновку; порожньо, якщо нічого'),
    allergens: z.array(z.enum(ALLERGENS)).describe('Для allergy — алергени; інакше порожньо'),
  })).describe('Лише обмеження в харчуванні, прямо написані у висновку'),
  prescriptions: z.array(z.object({
    kind: z.enum(['medication', 'supplement']),
    title: z.string().describe('Назва препарату, як написано'),
    dose: z.string().nullable().describe('Доза, як написано: «2000 МО», «1 таб.»; null, якщо немає'),
    times: z.array(z.string()).describe('Час прийому HH:MM — ЛИШЕ якщо час прямо написано; «2 рази на день» — це не час, тоді порожньо'),
    frequency: z.string().nullable().describe('Як часто й скільки, словами висновку: «2 рази на день, 2 місяці»; null, якщо немає'),
    withFood: z.boolean().nullable().describe('true — під час/після їжі, false — натщесерце/до їжі, null — не сказано'),
  })),
  tests: z.array(z.string()).describe('Аналізи й обстеження, які призначено зробити: «Глюкоза натще», «УЗД ОЧП»'),
  nextVisit: z.string().nullable().describe('Дата наступного візиту чи контролю, YYYY-MM-DD; null, якщо немає'),
  targets: z.object({
    kcal: z.number().nullable(), proteinG: z.number().nullable(), carbsMaxG: z.number().nullable(), fatG: z.number().nullable(),
    waterMl: z.number().nullable().describe('Вода на день у мл: «2 л» → 2000'),
    lastMealBy: z.string().nullable().describe('Останній прийом їжі до, HH:MM'),
    weightGoalKg: z.number().nullable(), maxWeightLossKgPerWeek: z.number().nullable(),
  }).describe('Лише числа, прямо написані у висновку; решта null'),
  note: z.string().nullable().describe('Коротко українською, що не вдалося прочитати чи що сумнівно; інакше null'),
});
export type ConclusionResult = z.infer<typeof ConclusionResult>;
export type ConclusionReader = (image: string) => Promise<{ result: ConclusionResult | 'refused'; usage?: Usage }>;

const SYSTEM = `На фото — висновок або рекомендації лікаря. Перепиши з нього для застосунку, що допомагає людині виконувати план свого лікаря: обмеження в харчуванні, призначені препарати з дозами, числові цілі, аналізи й обстеження, дату наступного візиту.
Лише те, що прямо написано. Нічого не додавай від себе, не тлумач діагнози, не радь. Не вигадуй час прийому: якщо написано «2 рази на день» — це frequency, а times порожні.
Не переписуй ім’я, прізвище, дату народження, адресу, номер картки — ні в які поля. Якщо щось не прочитати певно — пропусти й скажи про це в note. Якщо це не висновок лікаря — readable = false.`;

export function claudeConclusion(opts: { model: string; effort: Effort; client?: Anthropic }): ConclusionReader {
  const client = opts.client ?? new Anthropic({ timeout: 90_000, maxRetries: 1 });
  return (image) => structured(client, { model: opts.model, effort: opts.effort, maxTokens: 4000, system: SYSTEM, schema: ConclusionResult,
    content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }] });
}
