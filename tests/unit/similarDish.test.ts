import { describe, expect, it } from 'vitest';
import { similarDish } from '../../src/domain/recipes';
import type { Recipe } from '../../src/domain/types';

const dish = (id: string, name: string, builtIn = false): Recipe => ({ id, name, items: [], ...(builtIn ? { builtIn: true } : {}) });
const mine = [dish('a', 'Сирники'), dish('b', 'Борщ мамин'), dish('c', 'Плов', true)];

describe('«Це те саме?» before a second dish with nearly the same name (D164)', () => {
  it('finds the person’s own dish by the same name, a longer one, or one or two letters off', () => {
    expect(similarDish('сирники', mine)?.id).toBe('a');
    expect(similarDish('Сирники з родзинками', mine)?.id).toBe('a');
    expect(similarDish('Сырники', mine)?.id).toBe('a'); // the Russian spelling
    expect(similarDish('Борщ мамін', mine)?.id).toBe('b');
  });
  it('leaves built-in dishes, short names, other dishes and the dish itself alone', () => {
    expect(similarDish('Плов', mine)).toBeUndefined();
    expect(similarDish('Чай', mine)).toBeUndefined();
    expect(similarDish('Омлет', mine)).toBeUndefined();
    expect(similarDish('Сирники', mine, 'a')).toBeUndefined();
  });
});
