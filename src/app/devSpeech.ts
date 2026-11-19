// D175 (Soniox, PR 4): the voice experiment page `#/dev/speech` opens only with this flag — never for a patient by chance.
// One device turns it on with `?speechdev=on` (kept, like `?answers=on`, D166), `?speechdev=off` turns it back; a build
// can have it on with `VITE_DEV_SPEECH=true` (the e2e build does not).
const KEY = 'protocol.devSpeech';
const BUILD = import.meta.env.VITE_DEV_SPEECH === 'true';

export function devSpeech(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  const asked = new URLSearchParams(search).get('speechdev');
  try {
    if (asked === 'on' || asked === 'off') localStorage.setItem(KEY, asked);
    const kept = localStorage.getItem(KEY);
    return kept === 'on' ? true : kept === 'off' ? false : BUILD;
  } catch {
    return asked === 'on' || (asked !== 'off' && BUILD);
  }
}
