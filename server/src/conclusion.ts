// A photo of a doctor's conclusion (one or several pages) → a draft of the plan (SPEC.md D80, D101). The model copies
// what is written — limits, medicines with their doses exactly as on paper, how often and how long, targets, tests, the
// next visit — and for every line says where on which page it is and how sure it is; what it cannot read it returns as
// raw text. It never advises, never reads between the lines, never puts a time that is not on the paper (the app may
// *suggest* one, marked so). The diagnosis comes apart and is not kept. Names and personal data are not copied.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { structured, type Effort, type Usage } from './claude.ts';

const TAGS = ['oxalate', 'gallbladder', 'lactose', 'glycemic', 'iron', 'sodium', 'allergy', 'custom'] as const;
const ALLERGENS = ['gluten', 'milk', 'egg', 'fish', 'crustaceans', 'molluscs', 'peanut', 'nuts', 'soy', 'sesame', 'celery',
  'mustard', 'sulphites', 'lupin'] as const;
const where = {
  page: z.number().describe('Номер сторінки, з 1'),
  box: z.array(z.number()).describe('Де на сторінці цей рядок: [x, y, ширина, висота], частки від 0 до 1, від лівого верхнього кута'),
  sure: z.enum(['yes', 'check']).describe('yes — прочитано чітко; check — є сумнів (почерк, розмито, обрізано), людина має звірити'),
};

export const ConclusionResult = z.object({
  readable: z.boolean().describe('Чи це висновок / рекомендації / виписка лікаря і чи вдалося хоч щось прочитати'),
  date: z.string().nullable().describe('Дата висновку, YYYY-MM-DD; null, якщо не видно'),
  doctor: z.string().nullable().describe('Спеціальність лікаря, напр. «Ендокринолог»; без імені; null, якщо не видно'),
  diagnosis: z.string().nullable().describe('Діагноз, як написано, або null. Застосунок його не зберігає й не тлумачить'),
  diet: z.object({ said: z.string(), ...where }).nullable().describe('Дієта чи стіл, як написано: «стіл №5», «ЩД»; null, якщо немає'),
  constraints: z.array(z.object({
    tag: z.enum(TAGS).describe('oxalate — оксалатні камені/сечокам’яна; gallbladder — жовчний міхур, сладж; lactose — непереносимість лактози; glycemic — порушена глікемія, предіабет, діабет; iron — високий феритин/залізо; sodium — обмеження солі; allergy — алергія на продукт; custom — інше обмеження в їжі'),
    title: z.string().describe('Коротка назва, як у висновку'),
    reason: z.string().describe('Що саме сказано про їжу, словами висновку; порожньо, якщо нічого'),
    allergens: z.array(z.enum(ALLERGENS)).describe('Для allergy — алергени; інакше порожньо'),
    ...where,
  })).describe('Лише обмеження в харчуванні, прямо написані у висновку — нічого не виводь із діагнозу'),
  prescriptions: z.array(z.object({
    kind: z.enum(['medication', 'supplement']),
    title: z.string().describe('Назва препарату, як написано'),
    dose: z.string().nullable().describe('Доза рівно як на папері: «2000 МО», «1 таб.», «500 мг»; null, якщо не прочитано — не вгадуй'),
    times: z.array(z.string()).describe('Час прийому HH:MM — ЛИШЕ якщо час прямо написано; «2 рази на день» — це не час, тоді порожньо'),
    perDay: z.number().nullable().describe('Скільки разів на день, якщо написано («2 рази на день» → 2); null, якщо не написано'),
    frequency: z.string().nullable().describe('Як часто, словами висновку: «2 рази на день після їжі»; null, якщо немає'),
    durationDays: z.number().nullable().describe('Тривалість курсу в днях, якщо написано («14 днів» → 14, «1 місяць» → 30); null — без строку'),
    asNeeded: z.boolean().describe('true — «за потреби», «при болю»'),
    withFood: z.boolean().nullable().describe('true — під час/після їжі, false — натщесерце/до їжі, null — не сказано'),
    ...where,
  })),
  tests: z.array(z.object({ title: z.string(), ...where })).describe('Аналізи й обстеження, які призначено зробити'),
  nextVisit: z.object({ date: z.string(), ...where }).nullable().describe('Дата наступного візиту чи контролю, YYYY-MM-DD — лише якщо написана'),
  targets: z.array(z.object({
    key: z.enum(['kcal', 'proteinG', 'carbsMaxG', 'fatG', 'waterMl', 'lastMealBy', 'weightGoalKg', 'maxWeightLossKgPerWeek']),
    value: z.string().describe('Число (або HH:MM для lastMealBy), як написано: «2000», «2 л» → «2000» для waterMl'),
    ...where,
  })).describe('Лише цілі, прямо написані у висновку'),
  unread: z.array(z.object({ text: z.string().describe('Що вдалося розібрати, як є (можна частково)'), page: z.number(), box: z.array(z.number()) }))
    .describe('Рядки про лікування, які не вдалося прочитати певно — щоб людина додала вручну або пропустила'),
  note: z.string().nullable().describe('Коротко українською, що не вдалося прочитати чи що сумнівно; інакше null'),
});
export type ConclusionResult = z.infer<typeof ConclusionResult>;
export type ConclusionReader = (images: string[]) => Promise<{ result: ConclusionResult | 'refused'; usage?: Usage }>;

export const PROMPT_CONCLUSION = 'conclusion-2';
const SYSTEM = `На фото — висновок, виписка або рекомендації лікаря (одна чи кілька сторінок). Перепиши з них для застосунку, що допомагає людині виконувати план свого лікаря: обмеження в харчуванні, дієту, призначені препарати з дозами, як часто й як довго, числові цілі, аналізи й обстеження, дату наступного візиту.
Лише те, що прямо написано. Нічого не додавай від себе, не тлумач діагноз, не виводь обмежень із діагнозу, не радь.
Дозу пиши рівно як на папері; якщо доза не читається певно — dose = null і sure = check. Не вигадуй час прийому: «2 рази на день» — це perDay = 2 і frequency, а times порожні.
Для кожного рядка вкажи сторінку й рамку [x, y, ширина, висота] у частках сторінки та sure: yes лише коли прочитано чітко, інакше check. Те, що стосується лікування, але не читається, поверни в unread як є.
Не переписуй ім’я, прізвище, дату народження, адресу, номер картки — ні в які поля. Якщо це не документ лікаря — readable = false.`;

export function claudeConclusion(opts: { model: string; effort: Effort; client?: Anthropic }): ConclusionReader {
  const client = opts.client ?? new Anthropic({ timeout: 120_000, maxRetries: 1 });
  return (images) => structured(client, { model: opts.model, effort: opts.effort, maxTokens: 6000, system: SYSTEM, schema: ConclusionResult,
    content: [
      ...images.flatMap((data, i) => [{ type: 'text' as const, text: `Сторінка ${i + 1}` }, { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data } }]),
    ] });
}
