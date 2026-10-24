import { describe, expect, it } from 'vitest';
import { checked } from '../src/chat.ts';

describe('the assistant’s words on the way out (D117, R04)', () => {
  it('a sentence with a number goes — in figures or in words, and the words of an amount', () => {
    const r = checked({ topic: 'food', items: [], text: 'Гречка з яйцем — добрий вибір. З’їжте двісті грамів гречки. Це дасть півтори порції білка. Додайте трохи калорій. Ваша сім’я теж оцінить. Візьміть 150 г сиру.' }, []);
    expect(r.result.text).toBe('Гречка з яйцем — добрий вибір. Ваша сім’я теж оцінить.');
    expect(r.numbersDropped).toBe(4);
  });
});
