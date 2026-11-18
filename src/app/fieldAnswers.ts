// D166 flag: the assistant answers a question right in the one field on «Сьогодні». Off in production until the analyst has
// checked the answers on the live model; then `VITE_FIELD_ANSWERS=true` turns it on for everyone. One device can try it before:
// `?answers=on` (kept like the palette preview, D163), `?answers=off` turns it back. Off, a question is handed to «Помічник»
// unsent, as in D162.
const KEY = 'protocol.fieldAnswers';
const BUILD = import.meta.env.VITE_FIELD_ANSWERS === 'true';

export function fieldAnswers(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  const asked = new URLSearchParams(search).get('answers');
  try {
    if (asked === 'on' || asked === 'off') localStorage.setItem(KEY, asked);
    const kept = localStorage.getItem(KEY);
    return kept === 'on' ? true : kept === 'off' ? false : BUILD;
  } catch {
    return asked === 'on' || (asked !== 'off' && BUILD);
  }
}
