import { describe, expect, it } from 'vitest';
import { checked } from '../src/chat.ts';

describe('the assistant’s words on the way out (D117, R04)', () => {
  it('a sentence with a number goes — in figures or in words, and the words of an amount', () => {
    const r = checked({ topic: 'food', items: [], text: 'Гречка з яйцем — добрий вибір. З’їжте двісті грамів гречки. Це дасть півтори порції білка. Додайте трохи калорій. Ваша сім’я теж оцінить. Візьміть 150 г сиру.' }, []);
    expect(r.result.text).toBe('Гречка з яйцем — добрий вибір. Ваша сім’я теж оцінить.');
    expect(r.numbersDropped).toBe(4);
  });
});

describe('D201: the chat request for the prompt cache', () => {
  it('the base, sorted, is in the cached block after the instructions; the question is not', async () => {
    const { chatOpts } = await import('../src/chat.ts');
    const { requestOf } = await import('../src/claude.ts');
    const a = chatOpts({ model: 'm', effort: 'low' }, { text: 'що на вечерю?', history: [], names: ['Яйце', 'Гречка', 'Яйце'], context: { kcal: 1 } });
    const b = chatOpts({ model: 'm', effort: 'low' }, { text: 'а банан?', history: [{ role: 'user', text: 'що на вечерю?' }], names: ['Гречка', 'Яйце'], context: { kcal: 2 } });
    expect(a.reference).toBe('База (точні назви):\nГречка\nЯйце');
    expect(requestOf(a).system).toEqual(requestOf(b).system); // the same prefix whatever the question, the day or the order of the names
    expect(a.content).not.toContain('Гречка');
    expect(a.content).toContain('Людина: що на вечерю?');
  });
});
