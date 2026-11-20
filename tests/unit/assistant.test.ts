import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { examplePlan } from '../../src/data/seed.example';
import { asksTopup, brings, dayContext, fixedAnswer, lineOf, passing } from '../../src/domain/assistant';
import { scrubTalk, urgentReply, withoutDropped } from '../../src/domain/assistant';
import { dishItem } from '../../src/domain/recipes';
import { ZERO } from '../../src/domain/nutrition';

const plan = examplePlan(new Date('2026-10-24T12:00:00')); // lactose, glycemia, oxalate; Вітамін D
const foods = new Map(FOODS.map((f) => [f.id, f]));

describe('the assistant around the model (D117)', () => {
  it('«що добрати?» is the code’s question; «у мене вдома лише…» goes to the model', () => {
    for (const q of ['Що добрати до вечора?', 'чим добрати білок', 'що ще з’їсти', 'недобираю калорії']) expect(asksTopup(q), q).toBe(true);
    for (const q of ['у мене вдома лише яйця і гречка, що добрати?', 'чи можна мені банан?', 'що приготувати з курки']) expect(asksTopup(q), q).toBe(false);
    // D199: how one feels is not what is missing — the model, whose «symptoms» topic gives the app's words
    for (const q of ['трохи нудить після обіду — що з’їсти?', 'печія, що з’їсти?', 'болить живіт, що поїсти?', 'тошнит, что съесть?', 'важко в шлунку, що ще з’їсти?']) expect(asksTopup(q), q).toBe(false);
    for (const q of ['що ще з’їсти на вечерю?', 'чим добрати білок до вечора?']) expect(asksTopup(q), q).toBe(true);
  });
  it('medicines, symptoms, changing the plan — the app’s own words; medicines quote the plan', () => {
    expect(fixedAnswer('medicine', plan)).toMatch(/запитайте лікаря або фармацевта.*Вітамін D 2000 МО/);
    expect(fixedAnswer('symptoms', plan)).toMatch(/скаже лікар.*103/);
    expect(fixedAnswer('plan', plan)).toMatch(/змінює лікар/);
    expect(fixedAnswer('food', plan)).toBeUndefined();
  });
  it('a name becomes a line of the base; what fails the plan is not shown; the numbers are the code’s', () => {
    const lines = [lineOf('Яйце варене', 110, FOODS, RECIPES, dishItem)!, lineOf('Молоко 2,5 %', 200, FOODS, RECIPES, dishItem)!, lineOf('Гречка з куркою', 300, FOODS, RECIPES, dishItem)!];
    expect(lineOf('Протеїновий батончик', 60, FOODS, RECIPES, dishItem)).toBeUndefined();
    expect(lines[0]).toMatchObject({ name: 'Яйце варене', grams: 110, unit: { name: 'шт', qty: 2 } });
    const { shown, dropped } = passing(lines, plan, '2026-10-24', foods);
    expect(dropped).toEqual(['Молоко 2,5 %']); // lactose — never offered
    expect(shown.map((x) => x.name)).toEqual(['Яйце варене', 'Гречка з куркою']);
    expect(brings(shown[0]!, foods).protein).toBe(Math.round(12.6 * 1.1));
  });
  it('the model is told the day’s numbers and the plan’s rules — never a medicine', () => {
    const c = dayContext(plan, plan.targets, { ...ZERO, kcal: 900.4, protein: 60, fat: 30, carbs: 100, calciumMg: 400, waterMl: 500 }, '18:40', ['Яйце варене']);
    expect(c.day).toMatchObject({ kcal: 900, proteinG: 60 });
    expect(c.targets).toMatchObject({ kcal: 2100, proteinG: 140 });
    expect(JSON.stringify(c)).not.toContain('Вітамін D');
    expect(c.rules.join(' ')).toContain('лактози');
  });

  it('R04: the words never recommend a food the check took out; one still shown keeps its sentence', () => {
    const text = 'Підійде печінка куряча — багато заліза. Гречка з яйцем — швидко. Або кефір на ніч.';
    expect(withoutDropped(text, ['Печінка куряча'], ['Гречка варена', 'Кефір 2,5 %'])).toBe('Гречка з яйцем — швидко. Або кефір на ніч.');
    expect(withoutDropped(text, ['Гречка з куркою'], ['Гречка варена'])).toBe(text); // «гречка» is still shown — nothing to take out
  });
});

describe('D187: the assistant’s tails', () => {
  it('a food taken out is not recommended by any telling word of its name — a shared «каша» no longer saves «рисову кашу»', () => {
    const text = 'Зваріть рисову кашу на воді. Вівсянка теж підійде. До неї — трохи ягід.';
    expect(withoutDropped(text, ['Каша рисова'], ['Каша вівсяна'])).toBe('Вівсянка теж підійде. До неї — трохи ягід.');
    expect(withoutDropped('Відваріть курячу грудку. Додайте гречку.', ['Куряче філе (сире)'], ['Гречка варена'])).toBe('Додайте гречку.');
    // a short form in the text: «рис» for «Каша рисова»
    expect(withoutDropped('Можна рис. Або гречку.', ['Каша рисова'], ['Гречка варена'])).toBe('Або гречку.');
    // cooking words and brackets say nothing: «варена» does not take out a sentence about another boiled food
    expect(withoutDropped('Гречка варена — добре.', ['Рис білий варений'], ['Гречка варена'])).toBe('Гречка варена — добре.');
    // small words never match a short stem: «при» stays when «Приправа» goes
    expect(withoutDropped('Їжте повільно при вечері. Приправа — ні.', ['Приправа універсальна'], [])).toBe('Їжте повільно при вечері.');
  });
  it('the 103 card only for a call to call — not for 103 kcal, nor for «швидку викликати не потрібно»', () => {
    expect(urgentReply('Банан додасть близько 103 ккал.')).toBe(false);
    expect(urgentReply('Це 112 г вуглеводів на день.')).toBe(false);
    expect(urgentReply('Швидку викликати не потрібно — запишіть у звіт для лікаря.')).toBe(false);
    expect(urgentReply('Не треба викликати швидку, але скажіть лікарю.')).toBe(false);
    expect(urgentReply('Негайно телефонуйте 103.')).toBe(true);
    expect(urgentReply('Не чекайте — викличте швидку.')).toBe(true);
    expect(urgentReply('Швидка допомога не потрібна, але якщо біль посилиться — телефонуйте 103.')).toBe(true);
  });
  it('a kept talk: what came before a danger never returns, nor the old answer to it', () => {
    const kept = scrubTalk([
      { role: 'user' as const, text: 'у мене завтра аналізи, що їсти?' },
      { role: 'assistant' as const, text: 'Легка вечеря до 19:00.' },
      { role: 'user' as const, text: 'тисне в грудях і віддає в руку' },
      { role: 'assistant' as const, text: 'Спробуйте прилягти й випити води.' },
      { role: 'user' as const, text: 'що з’їсти на сніданок?' },
      { role: 'assistant' as const, text: 'Вівсянка з ягодами.' },
    ]);
    expect(kept.map((m) => m.text)).toEqual(['що з’їсти на сніданок?', 'Вівсянка з ягодами.']);
    expect(scrubTalk([{ role: 'user' as const, text: 'привіт' }, { role: 'assistant' as const, text: '', card: 'crisis' }, { role: 'user' as const, text: 'дякую' }]).map((m) => m.text)).toEqual(['дякую']);
  });
});
