// A photo of a doctor's conclusion (one or several pages) → a draft of the plan (SPEC.md D80, D101). The model copies
// what is written — limits, medicines with their doses exactly as on paper, how often and how long, targets, tests, the
// next visit — and for every line says where on which page it is and how sure it is; what it cannot read it returns as
// raw text. It never advises, never reads between the lines, never puts a time that is not on the paper.
// Missing clock values are entered explicitly during review (R7). The diagnosis comes apart and is not kept. Names and personal data are not copied.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { structured, type Effort, type Usage } from './claude.ts';

const TAGS = ['oxalate', 'gallbladder', 'lactose', 'glycemic', 'iron', 'sodium', 'allergy', 'custom'] as const;
const ALLERGENS = ['gluten', 'milk', 'egg', 'fish', 'crustaceans', 'molluscs', 'peanut', 'nuts', 'soy', 'sesame', 'celery',
  'mustard', 'sulphites', 'lupin'] as const;
const TARGETS = ['kcal', 'proteinG', 'carbsMaxG', 'fatG', 'waterMl', 'lastMealBy', 'weightGoalKg', 'maxWeightLossKgPerWeek'] as const;
type Where = { page: number; box: number[]; sure: 'yes' | 'check' };

/** What the app receives (the client's `ConclusionResult`, src/domain/conclusion.ts). */
export interface ConclusionResult {
  readable: boolean; date: string | null; doctor: string | null; diagnosis: null;
  diet: ({ said: string } & Where) | null;
  constraints: ({ tag: string; title: string; reason: string; allergens: string[] } & Where)[];
  prescriptions: ({ kind: 'medication' | 'supplement'; title: string; dose: string | null; times: string[]; perDay: number | null; frequency: string | null;
    durationDays: number | null; asNeeded: boolean; withFood: boolean | null } & Where)[];
  tests: ({ title: string } & Where)[];
  nextVisit: ({ date: string; title: string } & Where) | null;
  targets: ({ key: (typeof TARGETS)[number]; value: string } & Where)[];
  unread: { text: string; page: number; box: number[] }[];
  note: string | null;
}

// D101: what the model fills — one flat line shape and no nullable fields (empty = not said). Strict outputs compile the
// schema into a grammar; `conclusion-2` gave every group its own object and a dozen `null`s, and the API refused it as too
// large («The compiled grammar is too large»). The server turns these lines into the app's shape above.
const Line = z.object({
  group: z.enum(['medication', 'supplement', 'diet', 'limit', 'target', 'test', 'visit', 'unread']).describe('medication — ліки; supplement — вітаміни, добавки; diet — дієта чи стіл («стіл №5»); limit — обмеження в їжі; target — числова ціль; test — аналіз чи обстеження; visit — наступний візит чи огляд з датою; unread — рядок про лікування, який не вдалося прочитати певно'),
  title: z.string().describe('medication/supplement — назва препарату, як написано; limit — коротка назва обмеження; test/visit — що зробити; diet — як написано («стіл №5»); unread — що вдалося розібрати, як є'),
  words: z.string().describe('medication/supplement — як часто й як довго, словами висновку («2 рази на день під час їжі, тривало»); limit — що сказано про їжу; інакше порожньо'),
  dose: z.string().describe('Доза рівно як на папері: «500 мг», «1 табл.», «2000 МО»; порожньо, якщо не прочитано — не вгадуй'),
  times: z.array(z.string()).describe('Час прийому HH:MM — ЛИШЕ якщо годину прямо написано цифрами; «вранці», «ввечері», «2 рази на день» — це не час, тоді порожньо'),
  perDay: z.number().describe('Скільки разів на день, якщо написано («2 рази на день» → 2, «1 раз ввечері» → 1); 0 — не написано'),
  durationDays: z.number().describe('Тривалість курсу в днях, якщо написано («14 днів» → 14, «1 місяць» → 30); 0 — без строку чи «тривало»'),
  asNeeded: z.boolean().describe('true — «за потреби», «при болю»'),
  food: z.enum(['with', 'empty', 'unsaid']).describe('with — під час чи після їжі; empty — натщесерце чи до їжі; unsaid — не сказано'),
  tag: z.enum([...TAGS, 'none']).describe('Для limit: oxalate — оксалатні камені/сечокам’яна; gallbladder — жовчний міхур, сладж; lactose — непереносимість лактози; glycemic — обмеження вуглеводів, глікемія; iron — високий феритин/залізо; sodium — обмеження солі; allergy — алергія на продукт; custom — інше обмеження в їжі. Інакше none'),
  allergens: z.array(z.enum(ALLERGENS)).describe('Для limit з allergy — алергени; інакше порожньо'),
  target: z.enum([...TARGETS, 'none']).describe('Для target — що це за ціль; інакше none'),
  value: z.string().describe('Для target — число як написано (для lastMealBy HH:MM; «2 л» → «2000» для waterMl); інакше порожньо'),
  date: z.string().describe('Для visit — дата YYYY-MM-DD, лише якщо написана; інакше порожньо'),
  page: z.number().describe('Номер сторінки, з 1'),
  box: z.array(z.number()).describe('Де на сторінці цей рядок: [x, y, ширина, висота], частки від 0 до 1 від лівого верхнього кута'),
  sure: z.enum(['yes', 'check']).describe('yes — прочитано чітко; check — є сумнів (почерк, розмито, обрізано), людина має звірити'),
});
export const ConclusionModel = z.object({
  readable: z.boolean().describe('Чи це висновок / рекомендації / виписка лікаря і чи вдалося хоч щось прочитати'),
  date: z.string().describe('Дата документа, YYYY-MM-DD; порожньо, якщо не видно'),
  doctor: z.string().describe('Спеціальність лікаря чи відділення, напр. «Ендокринолог»; без імені; порожньо, якщо не видно'),
  lines: z.array(Line).describe('Кожен пункт призначень окремим рядком, у порядку на папері'),
  note: z.string().describe('Коротко українською, що не вдалося прочитати чи що сумнівно; інакше порожньо'),
});
export type ConclusionModel = z.infer<typeof ConclusionModel>;
export type ConclusionReader = (images: string[]) => Promise<{ result: ConclusionResult | 'refused'; usage?: Usage }>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The model's flat lines → the app's groups; empty means not said. */
export function toResult(m: ConclusionModel): ConclusionResult {
  const or = (s: string) => s.trim() || null;
  const at = (l: ConclusionModel['lines'][number]): Where => ({ page: l.page, box: l.box, sure: l.sure });
  const of = (g: string) => m.lines.filter((l) => l.group === g);
  const diet = of('diet').find((l) => l.title.trim());
  const visit = of('visit').find((l) => DATE.test(l.date));
  return {
    readable: m.readable, date: DATE.test(m.date) ? m.date : null, doctor: or(m.doctor), diagnosis: null,
    diet: diet ? { said: diet.title.trim(), ...at(diet) } : null,
    constraints: of('limit').map((l) => ({ tag: l.tag === 'none' ? 'custom' : l.tag, title: l.title, reason: l.words, allergens: l.allergens, ...at(l) })),
    prescriptions: m.lines.filter((l) => l.group === 'medication' || l.group === 'supplement').map((l) => ({
      kind: l.group as 'medication' | 'supplement', title: l.title, dose: or(l.dose), times: l.times, perDay: l.perDay > 0 ? l.perDay : null,
      frequency: or(l.words), durationDays: l.durationDays > 0 ? l.durationDays : null, asNeeded: l.asNeeded,
      withFood: l.food === 'with' ? true : l.food === 'empty' ? false : null, ...at(l) })),
    tests: [...of('test'), ...of('visit').filter((l) => l !== visit)].map((l) => ({ title: l.title, ...at(l) })),
    nextVisit: visit ? { date: visit.date, title: visit.title.trim(), ...at(visit) } : null,
    targets: of('target').filter((l) => l.target !== 'none').map((l) => ({ key: l.target as (typeof TARGETS)[number], value: l.value, ...at(l) })),
    unread: of('unread').map((l) => ({ text: l.title, page: l.page, box: l.box })),
    note: or(m.note),
  };
}

export const PROMPT_CONCLUSION = 'conclusion-3';
const SYSTEM = `На фото — висновок, виписка або рекомендації лікаря (одна чи кілька сторінок). Перепиши з них для застосунку, що допомагає людині виконувати план свого лікаря: дієту, обмеження в харчуванні, призначені препарати з дозами, як часто й як довго, числові цілі, аналізи й обстеження, дату наступного візиту.
Лише те, що прямо написано. Нічого не додавай від себе, не радь. Діагноз не переписуй і не виводь із нього обмежень — лише те, що написано в рекомендаціях.
Дозу пиши рівно як на папері; якщо доза не читається певно — dose порожня і sure = check. Не вигадуй час прийому: «2 рази на день» — це perDay = 2, а times порожні; «ввечері», «вранці» — теж не час.
Кожен пункт — окремий рядок: аналізи («контроль глюкози через 3 місяці») — test, а огляд лікаря з датою — visit, навіть якщо вони поруч; пункт, де сказано про дві речі («сіль до 5 г, без смаженого»), розбий на два. Для кожного рядка вкажи сторінку й рамку [x, y, ширина, висота] у частках сторінки та sure: yes лише коли прочитано чітко, інакше check. Те, що стосується лікування, але не читається, поверни як unread.
Не переписуй ім’я, прізвище, дату народження, адресу, номер картки, імена лікарів — ні в які поля. Якщо це не документ лікаря — readable = false.`;

export function claudeConclusion(opts: { model: string; effort: Effort; client?: Anthropic }): ConclusionReader {
  const client = opts.client ?? new Anthropic({ timeout: 120_000, maxRetries: 1 });
  return async (images) => {
    const { result, usage } = await structured(client, { model: opts.model, effort: opts.effort, maxTokens: 6000, system: SYSTEM, schema: ConclusionModel,
      content: images.flatMap((data, i) => [{ type: 'text' as const, text: `Сторінка ${i + 1}` }, { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data } }]) });
    return { result: result === 'refused' ? result : toResult(result), usage };
  };
}
