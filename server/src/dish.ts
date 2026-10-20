// A dish described in words → its ingredients with grams (SPEC.md D110), like a canteen's breakdown card. The model
// names each ingredient, its weight in the ready dish and — for one the person's base has in the same state — that base
// name; for the rest, its estimate per 100 g. The app counts every number from those (the base first), shows each line
// to be corrected and keeps the dish only when the person saves it. Nothing is written by the model.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { structured, type Effort, type Usage } from './claude.ts';

// D111: what an estimated ingredient is — the words of the app's plan check; the 14 allergens of EU Reg. 1169/2011
const TAGS = ['lactose', 'cheese-aged', 'salty', 'fried', 'fatty', 'sweet', 'fast-carb', 'oxalate-high', 'calcium'] as const;
const ALLERGENS = ['gluten', 'milk', 'egg', 'fish', 'crustaceans', 'molluscs', 'peanut', 'nuts', 'soy', 'sesame', 'celery', 'mustard', 'sulphites', 'lupin'] as const;

// flat, no nullables (D102: strict outputs compile the schema into a grammar; empty / 0 = not said)
export const DishResult = z.object({
  readable: z.boolean().describe('Чи це опис страви чи рецепта, з якого можна скласти інгредієнти'),
  name: z.string().describe('Коротка назва страви українською, як її назвала людина'),
  portions: z.number().describe('На скільки порцій описано (один рол — 1); якщо не сказано — 1'),
  items: z.array(z.object({
    said: z.string().describe('Інгредієнт, як його назвала людина, українською'),
    base: z.string().describe('Точна назва з наданого списку бази, ЛИШЕ якщо це той самий продукт у тому ж стані (сирий / варений / тушкований); інакше порожньо'),
    grams: z.number().describe('Вага інгредієнта в готовій страві на всі порції, г (як з’їдено, після приготування)'),
    amountSaid: z.boolean().describe('true — людина сама назвала кількість; false — це ваша оцінка звичайної кількості'),
    kcal: z.number().describe('Ккал на 100 г інгредієнта в такому вигляді, як у страві'),
    protein: z.number().describe('Білки, г на 100 г'),
    fat: z.number().describe('Жири, г на 100 г'),
    carbs: z.number().describe('Вуглеводи, г на 100 г'),
    tags: z.array(z.enum(TAGS)).describe('Що це за продукт (для перевірки за планом лікаря): lactose — містить лактозу (молоко, вершки, м’який чи розсільний сир, йогурт, сметана); cheese-aged — витриманий твердий сир; salty — солоне (розсільний сир, ковбаса, соління, соєвий соус); fried — смажене; fatty — жирне м’ясо, сало, жирний соус; sweet — доданий цукор, солодке; fast-carb — білий хліб, лаваш, білий рис, випічка; oxalate-high — шпинат, щавель, ревінь, буряк, какао; calcium — сир, молочне. Порожньо, якщо нічого з цього'),
    allergens: z.array(z.enum(ALLERGENS)).describe('Алергени з 14 обов’язкових, що є в цьому інгредієнті; порожньо, якщо немає'),
  })).describe('Кожен названий інгредієнт окремо — і спеції, і соус розкладені на складові; нічого не додавай від себе'),
  note: z.string().describe('Коротко українською, що оцінено грубо (напр. жирність м’яса); інакше порожньо'),
});
export type DishResult = z.infer<typeof DishResult>;
export type DishReader = (input: { text: string; foods: string[] }) => Promise<{ result: DishResult | 'refused'; usage?: Usage }>;

export const PROMPT_DISH = 'dish-2';
const SYSTEM = `Людина описала страву, яку приготувала, — назву й склад. Розклади її на інгредієнти, як технологічна картка: кожен названий інгредієнт окремим рядком з вагою в готовій страві.
Лише названі інгредієнти — нічого не додавай від себе. Соус і маринад теж розклади на складові. Сіль, спеції — малими вагами, як звичайно кладуть.
Кількість, якої людина не назвала, оціни як звичайну для такої страви на вказану кількість порцій і познач amountSaid = false. Вагу давай у готовому вигляді: м’ясо після тушкування важить менше, ніж сире.
Якщо в наданому списку бази є той самий продукт у тому ж стані — впиши його назву в base точно, як у списку. Сире м’ясо в списку — не те саме, що тушковане в страві: тоді base порожньо.
Для кожного рядка дай свою оцінку ккал і БЖУ на 100 г продукту в такому вигляді, як у страві. Не давай порад і не оцінюй, корисна страва чи ні. Якщо це не опис страви — readable = false.`;

export function claudeDish(opts: { model: string; effort: Effort; client?: Anthropic }): DishReader {
  const client = opts.client ?? new Anthropic({ timeout: 90_000, maxRetries: 1 });
  return ({ text, foods }) => structured(client, { model: opts.model, effort: opts.effort, maxTokens: 4000, system: SYSTEM, schema: DishResult,
    content: `Страва:\n${text}\n\nСписок бази (точні назви):\n${foods.join('\n')}` });
}
