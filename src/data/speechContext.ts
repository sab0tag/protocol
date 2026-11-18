// D173: the hints the speech engine gets (Soniox `context` and `language_hints`) — from what is the same for everyone, never
// from the person: the common medicines (commonMeds.ts), the words of the commands and the stop phrases (D105, D107), the
// food base and the dishes. No plan, no name, no diagnosis goes along. Soniox takes up to 8000 tokens of context; the list
// stays well under it — medicines and commands first, then foods and dishes in the base's order.
import { FOODS } from './foods';
import { RECIPES } from './recipes';
import { COMMON_MEDS } from './commonMeds';

export const LANGUAGE_HINTS = ['uk', 'ru'] as const; // people mix the two in one phrase; no translation
const COMMANDS = ['прибери', 'видали', 'замість', 'не два, а три', 'скасуй останнє', 'це все', 'склянка води', 'легкий день', 'випив', 'прийняв'];
/** ≈ 10 000 characters is the 8000-token limit; keep a margin */
export const CONTEXT_CHAR_BUDGET = 6000;

export interface SpeechContext { general: { key: string; value: string }[]; terms: string[] }

export function speechContext(budget = CONTEXT_CHAR_BUDGET): SpeechContext {
  const seen = new Set<string>(), terms: string[] = [];
  let used = 0;
  const add = (t: string) => {
    const w = t.trim(), k = w.toLocaleLowerCase('uk');
    if (!w || seen.has(k) || used + w.length + 2 > budget) return;
    seen.add(k); terms.push(w); used += w.length + 2;
  };
  for (const m of COMMON_MEDS) add(m);
  for (const c of COMMANDS) add(c);
  for (const f of FOODS) add(f.name.replace(/\s*\(.*?\)\s*/gu, ' ').replace(/\s+\d.*$/u, '').trim());
  for (const r of RECIPES) add(r.name);
  return { general: [{ key: 'domain', value: 'щоденник харчування і прийому ліків' }, { key: 'language', value: 'українська, іноді російська' }], terms };
}
