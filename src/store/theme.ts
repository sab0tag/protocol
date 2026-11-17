export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'protocol.theme';

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function applyThemePreference(preference: ThemePreference): void {
  if (preference === 'system') {
    document.documentElement.removeAttribute('data-theme');
    return;
  }
  document.documentElement.dataset.theme = preference;
}

export function saveThemePreference(preference: ThemePreference): void {
  localStorage.setItem(STORAGE_KEY, preference);
  applyThemePreference(preference);
}

export function initializeTheme(): void {
  applyThemePreference(readThemePreference());
}

// D163: the direction-C palette, previewed before it becomes the default (step 6 of the simplification spec).
// `?palette=c` turns it on for this device, `?palette=default` turns it off; the choice is kept like the theme.
const PALETTE_KEY = 'protocol.palette';
export type Palette = 'default' | 'c';

export function readPalette(search: string = location.search): Palette {
  const asked = new URLSearchParams(search).get('palette');
  try {
    if (asked === 'c' || asked === 'default') localStorage.setItem(PALETTE_KEY, asked);
    return localStorage.getItem(PALETTE_KEY) === 'c' ? 'c' : 'default';
  } catch {
    return asked === 'c' ? 'c' : 'default';
  }
}

export function applyPalette(palette: Palette): void {
  if (palette === 'c') document.documentElement.dataset.palette = 'c';
  else document.documentElement.removeAttribute('data-palette');
}

export function initializePalette(): void {
  applyPalette(readPalette());
}
